<script setup lang="ts">
import type { SiteConfig } from "@notepad/core"
import { GitBranch, Loader2, LogIn, StickyNote, UserPlus } from "@lucide/vue"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/api/client"
import LocaleSwitcher from "@/components/LocaleSwitcher.vue"
import ThemeToggle from "@/components/ThemeToggle.vue"
import { currentLocale, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      reset: (widgetId?: string) => void
      remove?: (widgetId: string) => void
    }
    onNotepadTurnstileLoaded?: () => void
  }
}

const TURNSTILE_SCRIPT_ID = "notepad-turnstile-script"
let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined" || window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    window.onNotepadTurnstileLoaded = () => resolve()

    const existing = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = TURNSTILE_SCRIPT_ID
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onNotepadTurnstileLoaded"
    script.async = true
    script.defer = true
    script.addEventListener("error", () => reject(new Error("Turnstile script failed")), { once: true })
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

const auth = useAuthStore()
const router = useRouter()
const mode = ref<"login" | "register">("login")
const config = ref<SiteConfig | null>(null)
const username = ref("")
const password = ref("")
const loading = ref(false)
const loadingConfig = ref(true)
const error = ref("")
const turnstileElement = ref<HTMLElement | null>(null)
const turnstileWidgetId = ref<string | null>(null)
const turnstileToken = ref("")

const turnstileEnabled = computed(() => Boolean(config.value?.turnstile?.enabled && config.value.turnstile.siteKey))
const githubEnabled = computed(() =>
  Boolean(config.value?.github?.enabled && config.value.github.clientId && config.value.github.clientSecretConfigured)
)

function resetTurnstile() {
  turnstileToken.value = ""
  if (turnstileWidgetId.value) {
    window.turnstile?.reset(turnstileWidgetId.value)
  }
}

async function renderTurnstile() {
  if (!turnstileEnabled.value || !turnstileElement.value || turnstileWidgetId.value) return
  await loadTurnstileScript()
  if (!window.turnstile || !turnstileElement.value || !config.value?.turnstile?.siteKey) return

  turnstileWidgetId.value = window.turnstile.render(turnstileElement.value, {
    sitekey: config.value.turnstile.siteKey,
    language: currentLocale.value,
    callback: (token: string) => {
      turnstileToken.value = token
    },
    "expired-callback": () => {
      turnstileToken.value = ""
    },
    "error-callback": () => {
      turnstileToken.value = ""
      error.value = t("auth.turnstileFailed")
    }
  })
}

function removeTurnstile() {
  if (turnstileWidgetId.value) {
    window.turnstile?.remove?.(turnstileWidgetId.value)
    turnstileWidgetId.value = null
    turnstileToken.value = ""
  }
}

async function submit() {
  error.value = ""
  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = t("auth.turnstileRequired")
    return
  }

  loading.value = true
  try {
    if (mode.value === "login") {
      await auth.login(username.value, password.value, turnstileToken.value || undefined)
    } else {
      await auth.register(username.value, password.value, turnstileToken.value || undefined)
    }
    await router.push(auth.hasWorkspaceAccess ? "/notes" : "/pending")
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.failed")
    resetTurnstile()
  } finally {
    loading.value = false
  }
}

watch(turnstileEnabled, async (enabled) => {
  if (!enabled) {
    removeTurnstile()
    return
  }
  await nextTick()
  await renderTurnstile()
})

watch(currentLocale, async () => {
  if (!turnstileEnabled.value) return
  removeTurnstile()
  await nextTick()
  await renderTurnstile()
})

onMounted(async () => {
  try {
    config.value = await api.config()
    await nextTick()
    await renderTurnstile()
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.configFailed")
  } finally {
    loadingConfig.value = false
  }
})

onBeforeUnmount(removeTurnstile)
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-head">
        <StickyNote :size="24" />
        <h1>Notepad</h1>
        <div class="login-tools">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </div>

      <div class="mode-tabs" role="tablist">
        <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">
          <LogIn :size="16" />
          {{ t("auth.login") }}
        </button>
        <button :class="{ active: mode === 'register' }" type="button" @click="mode = 'register'">
          <UserPlus :size="16" />
          {{ t("auth.register") }}
        </button>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label>
          <span>{{ t("auth.username") }}</span>
          <input v-model.trim="username" class="input" autocomplete="username" minlength="3" maxlength="32" required />
        </label>

        <label>
          <span>{{ t("auth.password") }}</span>
          <input
            v-model="password"
            class="input"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            required
            minlength="8"
          />
        </label>

        <div v-if="turnstileEnabled" ref="turnstileElement" class="turnstile-box" />

        <p v-if="error" class="error">{{ error }}</p>

        <button class="button submit-button" type="submit" :disabled="loading || loadingConfig">
          <Loader2 v-if="loading || loadingConfig" class="spin" :size="16" />
          {{
            loading || loadingConfig
              ? t("auth.working")
              : mode === "login"
                ? t("auth.login")
                : t("auth.createAccount")
          }}
        </button>
      </form>

      <div v-if="githubEnabled" class="divider"><span>{{ t("auth.or") }}</span></div>

      <a v-if="githubEnabled" class="github-button" :href="api.githubLoginUrl">
        <GitBranch :size="18" />
        {{ t("auth.github") }}
      </a>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
}

.login-panel {
  width: min(420px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 28px;
}

.login-head {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--accent);
  margin-bottom: 22px;
}

.login-tools {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.login-head h1 {
  font-size: 24px;
  line-height: 1;
  margin: 0;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 20px;
}

.mode-tabs button {
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-weight: 600;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.mode-tabs button.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--surface-hover);
}

.login-form {
  display: grid;
  gap: 14px;
}

label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--muted);
}

.submit-button {
  width: 100%;
  margin-top: 4px;
}

.turnstile-box {
  min-height: 65px;
}

.divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
  margin: 22px 0;
}

.divider::before,
.divider::after {
  content: "";
  height: 1px;
  flex: 1;
  background: var(--line);
}

.github-button {
  min-height: 40px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text);
  text-decoration: none;
  font-weight: 650;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.github-button:hover {
  background: var(--panel-2);
}
</style>
