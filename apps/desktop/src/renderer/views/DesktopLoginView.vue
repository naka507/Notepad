<script setup lang="ts">
import { GitBranch, Loader2, LogIn, Server, UserPlus } from "@lucide/vue"
import { onMounted, ref } from "vue"
import { api } from "@/api/client"
import LocaleSwitcher from "@web/components/LocaleSwitcher.vue"
import ThemeToggle from "@web/components/ThemeToggle.vue"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"

const auth = useAuthStore()

const mode = ref<"login" | "register">("login")
const serverInput = ref(auth.serverUrl)
const showServerEdit = ref(false)
const username = ref("")
const password = ref("")
const loading = ref(false)
const githubEnabled = ref(false)
const turnstileEnabled = ref(false)
const error = ref("")

async function probeServerConfig() {
  try {
    await auth.setServerUrl(serverInput.value)
    const cfg = await api.config()
    githubEnabled.value = cfg.github.enabled
    turnstileEnabled.value = Boolean(cfg.turnstile?.enabled)
    if (turnstileEnabled.value) mode.value = "login"
    error.value = ""
  } catch {
    githubEnabled.value = false
    turnstileEnabled.value = false
  }
}

async function submit() {
  loading.value = true
  error.value = ""
  try {
    await auth.setServerUrl(serverInput.value)
    if (mode.value === "login") {
      await auth.login({ username: username.value, password: password.value })
    } else {
      await auth.register({ username: username.value, password: password.value })
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("auth.failed")
  } finally {
    loading.value = false
  }
}

async function openGithubOAuth() {
  await auth.setServerUrl(serverInput.value)
  if (window.notepadDesktop) {
    await window.notepadDesktop.openExternal(api.githubLoginUrl)
  } else {
    window.open(api.githubLoginUrl, "_blank")
  }
}

onMounted(probeServerConfig)
</script>

<template>
  <main class="desk-login">
    <section class="desk-login-card">
      <div class="login-head">
        <img src="/favicon.svg" alt="Notepad" class="brand-logo lg" />
        <div>
          <h1>Notepad Desktop</h1>
          <button class="server-chip" type="button" @click="showServerEdit = !showServerEdit">
            <Server :size="11" />
            <span>{{ serverInput }}</span>
          </button>
        </div>
        <div class="head-tools">
          <ThemeToggle />
          <LocaleSwitcher />
        </div>
      </div>

      <div v-if="showServerEdit" class="server-box">
        <input v-model.trim="serverInput" class="input" placeholder="https://note.qqx.qzz.io" />
        <div class="server-presets">
          <button class="ghost-button tiny" type="button" @click="serverInput = 'https://note.qqx.qzz.io'; probeServerConfig()">
            线上服务
          </button>
          <button class="ghost-button tiny" type="button" @click="serverInput = 'http://127.0.0.1:8787'; probeServerConfig()">
            本地 8787
          </button>
        </div>
      </div>

      <div v-if="!turnstileEnabled" class="mode-tabs">
        <button :class="{ active: mode === 'login' }" type="button" @click="mode = 'login'">
          <LogIn :size="15" />
          {{ t("auth.login") }}
        </button>
        <button :class="{ active: mode === 'register' }" type="button" @click="mode = 'register'">
          <UserPlus :size="15" />
          {{ t("auth.register") }}
        </button>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <label>
          <span>{{ t("auth.username") }}</span>
          <input v-model.trim="username" class="input" minlength="3" maxlength="32" required />
        </label>
        <label>
          <span>{{ t("auth.password") }}</span>
          <input v-model="password" class="input" type="password" minlength="8" required />
        </label>

        <p v-if="error" class="error">{{ error }}</p>

        <button class="button submit-btn" type="submit" :disabled="loading">
          <Loader2 v-if="loading" class="spin" :size="15" />
          {{ loading ? t("auth.working") : mode === "login" ? t("auth.login") : t("auth.createAccount") }}
        </button>
      </form>

      <template v-if="githubEnabled">
        <div class="divider"><span>{{ t("auth.or") }}</span></div>
        <button class="ghost-button gh-btn" type="button" @click="openGithubOAuth">
          <GitBranch :size="16" />
          {{ t("auth.github") }}
        </button>
      </template>
    </section>
  </main>
</template>

<style scoped>
.desk-login {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--bg);
}

.desk-login-card {
  width: min(410px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow);
  padding: 24px;
}

.login-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}

.login-head h1 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.server-chip {
  margin-top: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.server-chip:hover {
  color: var(--text);
}

.head-tools {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

.server-box {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
}

.server-presets {
  display: flex;
  gap: 6px;
}

.tiny {
  min-height: 26px;
  font-size: 11px;
  padding: 0 8px;
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}

.mode-tabs button {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.mode-tabs button.active {
  border-color: var(--accent);
  background: var(--surface-hover);
  color: var(--accent);
}

.login-form {
  display: grid;
  gap: 12px;
}

.login-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}

.submit-btn,
.gh-btn {
  width: 100%;
}

.divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin: 16px 0;
}

.divider::before,
.divider::after {
  content: "";
  height: 1px;
  flex: 1;
  background: var(--line);
}
</style>
