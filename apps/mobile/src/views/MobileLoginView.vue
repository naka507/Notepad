<script setup lang="ts">
import { ChevronDown, ChevronUp, GitBranch, Globe, Loader2, LogIn, UserPlus } from "@lucide/vue"
import LocaleSwitcher from "@web/components/LocaleSwitcher.vue"
import ThemeToggle from "@web/components/ThemeToggle.vue"
import { ref } from "vue"
import { api, DEFAULT_SERVER_URL } from "@/api/client"
import { currentLocale as locale, t } from "@/i18n"
import { openExternalUrl } from "@/native/bridge"
import { useAuthStore } from "@/stores/auth"

const emit = defineEmits<{
  authenticated: []
}>()

const auth = useAuthStore()

const mode = ref<"login" | "register">("login")
const serverInput = ref(auth.serverUrl || DEFAULT_SERVER_URL)
const showServerBox = ref(false)
const username = ref("")
const password = ref("")
const submitting = ref(false)
const error = ref("")

async function applyServer(url: string) {
  serverInput.value = url
  await auth.setServerUrl(url)
}

async function submit() {
  error.value = ""
  submitting.value = true
  try {
    if (serverInput.value.trim() && serverInput.value.trim() !== auth.serverUrl) {
      await auth.setServerUrl(serverInput.value)
    }
    if (mode.value === "login") {
      await auth.login({ username: username.value, password: password.value })
    } else {
      await auth.register({ username: username.value, password: password.value })
    }
    emit("authenticated")
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.failed")
  } finally {
    submitting.value = false
  }
}

async function startGithubLogin() {
  if (serverInput.value.trim() && serverInput.value.trim() !== auth.serverUrl) {
    await auth.setServerUrl(serverInput.value)
  }
  await openExternalUrl(api.githubLoginUrl)
}
</script>

<template>
  <div class="m-login-shell">
    <div class="m-login-top">
      <div class="m-login-tools">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
    </div>

    <div class="m-login-body">
      <div class="m-brand-hero">
        <img class="brand-logo" src="/favicon.svg" alt="Notepad" />
        <h1>Notepad</h1>
        <p class="muted">{{ locale === "zh-CN" ? "随身云笔记与 2FA 验证码" : "Cloud notes & 2FA authenticator" }}</p>
      </div>

      <div class="m-card m-login-card">
        <div class="m-segmented">
          <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">
            <LogIn :size="14" />
            {{ t("auth.login") }}
          </button>
          <button
            :class="{ active: mode === 'register' }"
            type="button"
            @click="mode = 'register'"
          >
            <UserPlus :size="14" />
            {{ t("auth.register") }}
          </button>
        </div>

        <form class="m-login-form" @submit.prevent="submit">
          <label class="m-field">
            <span>{{ t("auth.username") }}</span>
            <input
              v-model.trim="username"
              class="input m-input"
              autocomplete="username"
              required
              minlength="2"
              maxlength="32"
            />
          </label>

          <label class="m-field">
            <span>{{ t("auth.password") }}</span>
            <input
              v-model="password"
              class="input m-input"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              required
              minlength="8"
              maxlength="128"
            />
          </label>

          <p v-if="error" class="m-error">{{ error }}</p>

          <button class="button m-submit" type="submit" :disabled="submitting">
            <Loader2 v-if="submitting" class="spin" :size="16" />
            {{ mode === "login" ? t("auth.login") : t("auth.register") }}
          </button>
        </form>

        <template v-if="auth.siteConfig?.github.enabled">
          <div class="m-divider"><span>{{ t("auth.or") }}</span></div>
          <button class="ghost-button m-submit" type="button" @click="startGithubLogin">
            <GitBranch :size="16" />
            {{ t("auth.github") }}
          </button>
        </template>

        <div class="server-toggle-wrap">
          <button class="server-toggle" type="button" @click="showServerBox = !showServerBox">
            <span class="server-label">
              <Globe :size="13" />
              {{ serverInput }}
            </span>
            <ChevronUp v-if="showServerBox" :size="14" />
            <ChevronDown v-else :size="14" />
          </button>

          <div v-if="showServerBox" class="server-panel">
            <input
              v-model.trim="serverInput"
              class="input"
              type="url"
              placeholder="https://note.qqx.qzz.io"
              @blur="applyServer(serverInput)"
            />
            <div class="server-presets">
              <button
                class="preset-chip"
                :class="{ active: serverInput === DEFAULT_SERVER_URL }"
                type="button"
                @click="applyServer(DEFAULT_SERVER_URL)"
              >
                {{ locale === "zh-CN" ? "线上服务" : "Cloud" }}
              </button>
              <button
                class="preset-chip"
                :class="{ active: serverInput === 'http://127.0.0.1:8787' }"
                type="button"
                @click="applyServer('http://127.0.0.1:8787')"
              >
                {{ locale === "zh-CN" ? "本地 8787" : "Local 8787" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.m-login-shell {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  padding: var(--safe-top) 18px calc(24px + var(--safe-bottom));
  overflow-y: auto;
}

.m-login-top {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.m-login-tools {
  display: flex;
  align-items: center;
  gap: 6px;
}

.m-login-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: min(400px, 100%);
  margin: 0 auto;
  gap: 20px;
}

.m-brand-hero {
  display: grid;
  justify-items: center;
  gap: 6px;
  text-align: center;
}

.brand-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.1);
}

.m-brand-hero h1 {
  margin: 4px 0 0;
  font-size: 24px;
  letter-spacing: -0.02em;
}

.m-brand-hero p {
  margin: 0;
  font-size: 13px;
}

.m-login-card {
  padding: 18px;
  display: grid;
  gap: 14px;
}

.m-login-form {
  display: grid;
  gap: 12px;
}

.m-field {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}

.m-input {
  height: 44px;
  font-size: 15px;
  border-radius: 10px;
}

.m-submit {
  width: 100%;
  min-height: 44px;
  font-size: 15px;
  border-radius: 10px;
}

.m-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.m-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 11px;
}

.m-divider::before,
.m-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--line);
}

.server-toggle-wrap {
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: grid;
  gap: 8px;
}

.server-toggle {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
  cursor: pointer;
}

.server-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-panel {
  display: grid;
  gap: 8px;
}

.server-presets {
  display: flex;
  gap: 6px;
}

.preset-chip {
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.preset-chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}
</style>
