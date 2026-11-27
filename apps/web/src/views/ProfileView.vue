<script setup lang="ts">
import { PERMISSIONS, type SiteConfig, type StorageStats } from "@notepad/core"
import { BookOpen, Check, Copy, GitBranch, HardDrive, KeyRound, Loader2, Save, Shield, Unlink } from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, ref, type Component } from "vue"
import { useRoute, useRouter } from "vue-router"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import HelpDialog from "@/components/HelpDialog.vue"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { formatBytes } from "@/utils/format"

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const config = ref<SiteConfig | null>(null)
const storageStats = ref<StorageStats | null>(null)
const loadingConfig = ref(true)
const loadingStorage = ref(false)
const helpOpen = ref(false)
const passwordDialogOpen = ref(false)
const currentPassword = ref("")
const newPassword = ref("")
const nextUsername = ref("")
const savingPassword = ref(false)
const hardLimitGb = ref("9.8")
const copiedCallback = ref(false)

const githubCallbackUrl = computed(() => {
  if (typeof window === "undefined") return "/api/auth/github/callback"
  return `${window.location.origin}/api/auth/github/callback`
})

async function copyCallbackUrl() {
  await navigator.clipboard.writeText(githubCallbackUrl.value)
  copiedCallback.value = true
  window.setTimeout(() => {
    copiedCallback.value = false
  }, 1500)
}

const canManageConfig = computed(() => auth.hasPermission(PERMISSIONS.CONFIG_MANAGE))
const githubAccount = computed(
  () => auth.user?.linkedAccounts.find((a) => a.provider === "github") ?? null
)
const githubOAuthReady = computed(() =>
  Boolean(config.value?.github.enabled && config.value.github.clientId && config.value.github.clientSecretConfigured)
)
const storageRatio = computed(() => {
  if (!storageStats.value || !storageStats.value.freeTierLimitBytes) return 0
  return Math.min(100, Math.round((storageStats.value.totalBytes / storageStats.value.freeTierLimitBytes) * 100))
})

async function loadData() {
  loadingConfig.value = true
  loadingStorage.value = canManageConfig.value

  const configTask = api
    .config()
    .then((siteCfg) => {
      config.value = {
        ...siteCfg,
        turnstile: { ...siteCfg.turnstile, secretKey: siteCfg.turnstile.secretKey ?? "" },
        github: { ...siteCfg.github, clientSecret: siteCfg.github.clientSecret ?? "" }
      }
      hardLimitGb.value = (siteCfg.storageGuardrail.hardLimitBytes / (1024 * 1024 * 1024)).toFixed(1)
    })
    .finally(() => {
      loadingConfig.value = false
    })

  const storageTask = canManageConfig.value
    ? api
        .storageStats()
        .then((res) => {
          storageStats.value = res.stats
        })
        .finally(() => {
          loadingStorage.value = false
        })
    : Promise.resolve()

  await Promise.all([configTask, storageTask])
}

function openPasswordModal() {
  currentPassword.value = ""
  newPassword.value = ""
  nextUsername.value = auth.user?.username ?? ""
  passwordDialogOpen.value = true
}

async function submitPassword() {
  savingPassword.value = true
  try {
    if (auth.user?.hasPassword) {
      await api.changePassword({
        currentPassword: currentPassword.value,
        newPassword: newPassword.value
      })
    } else {
      await api.setPassword({
        password: newPassword.value,
        ...(nextUsername.value.trim() ? { username: nextUsername.value.trim() } : {})
      })
    }
    passwordDialogOpen.value = false
    await auth.loadSession()
    ElMessage.success(t("profile.passwordUpdated"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  } finally {
    savingPassword.value = false
  }
}

async function unlinkGithub() {
  const confirmed = await confirmDialog({
    title: t("profile.unbindGithub"),
    message: t("profile.confirmUnbind"),
    confirmText: t("profile.unbindGithub"),
    tone: "danger"
  })
  if (!confirmed) return
  try {
    await api.unbindGithub()
    await auth.loadSession()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

async function saveConfig() {
  if (!config.value) return
  try {
    const parsedGb = Math.max(0.5, Number(hardLimitGb.value) || 9.8)
    const hardLimitBytes = Math.round(parsedGb * 1024 * 1024 * 1024)
    const softWarnBytes = Math.min(Math.round(hardLimitBytes * 0.92), hardLimitBytes)
    await api.updateConfig({
      ...config.value,
      storageGuardrail: {
        ...config.value.storageGuardrail,
        softWarnBytes,
        hardLimitBytes
      }
    })
    ElMessage.success(t("profile.configSaved"))
    await loadData()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

onMounted(async () => {
  await loadData()
  const bindStatus = route.query.bind
  if (bindStatus === "success") {
    await auth.loadSession()
    ElMessage.success(t("profile.bindSuccess"))
    await router.replace("/profile")
  } else if (bindStatus === "conflict") {
    ElMessage.error(t("profile.bindConflict"))
    await router.replace("/profile")
  }
})
</script>

<template>
  <main class="profile-page">
    <section class="profile-band">
      <div class="identity">
        <img v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl" alt="" />
        <div v-else class="avatar">{{ auth.user?.name?.[0] || auth.user?.username?.[0] || "N" }}</div>
        <div>
          <div class="identity-title">
            <h1>{{ auth.user?.name || auth.user?.username }}</h1>
            <span class="role-badge">{{ t(`role.${auth.user?.role ?? "pending"}`) }}</span>
          </div>
          <p class="muted">{{ auth.user?.username || auth.user?.email }}</p>
        </div>
      </div>

      <button class="ghost-button" type="button" @click="helpOpen = true">
        <BookOpen :size="16" />
        {{ t("profile.helpCard") }}
      </button>
    </section>

    <div class="profile-grid">
      <!-- Account Security -->
      <section class="panel" :class="{ wide: !canManageConfig }">
        <header>
          <div class="panel-title">
            <KeyRound :size="18" />
            <h2>{{ t("profile.security") }}</h2>
          </div>
        </header>

        <div class="setting-row">
          <div>
            <strong>{{ t("auth.password") }}</strong>
            <p class="muted">{{ auth.user?.hasPassword ? t("profile.bound") : t("profile.unbound") }}</p>
          </div>
          <button class="ghost-button small" type="button" @click="openPasswordModal">
            {{ auth.user?.hasPassword ? t("profile.changePassword") : t("profile.setPassword") }}
          </button>
        </div>

        <div class="setting-row">
          <div>
            <strong>{{ t("profile.github") }}</strong>
            <p class="muted">
              {{ githubAccount ? githubAccount.providerLogin || t("profile.bound") : t("profile.unbound") }}
            </p>
          </div>
          <button
            v-if="githubAccount"
            class="danger-button small"
            type="button"
            :disabled="!auth.user?.hasPassword"
            @click="unlinkGithub"
          >
            <Unlink :size="14" />
            {{ t("profile.unbindGithub") }}
          </button>
          <a v-else-if="githubOAuthReady" class="ghost-button small link-btn" :href="api.githubBindUrl">
            <GitBranch :size="14" />
            {{ t("profile.bindGithub") }}
          </a>
        </div>
      </section>

      <!-- Admin Storage Container Usage -->
      <section v-if="canManageConfig" class="panel storage-panel">
        <header>
          <div class="panel-title">
            <HardDrive :size="18" />
            <h2>{{ t("profile.storage") }}</h2>
          </div>
          <strong v-if="storageStats" class="storage-summary">
            {{ formatBytes(storageStats.totalBytes) }} / {{ formatBytes(storageStats.freeTierLimitBytes) }}
          </strong>
          <Loader2 v-else-if="loadingStorage" class="spin muted" :size="15" />
        </header>

        <div v-if="loadingStorage && !storageStats" class="card-loading">
          <Loader2 class="spin" :size="18" />
          <span>{{ t("common.loading") }}</span>
        </div>

        <template v-else-if="storageStats">
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${storageRatio}%` }" />
          </div>

          <div class="stat-grid">
            <div class="stat-box">
              <span class="muted">{{ t("nav.users") }}</span>
              <strong>{{ storageStats.totalUsers }}</strong>
            </div>
            <div class="stat-box">
              <span class="muted">{{ t("nav.notes") }}</span>
              <strong>{{ storageStats.totalNotes }}</strong>
            </div>
            <div class="stat-box">
              <span class="muted">{{ t("nav.files") }}</span>
              <strong>{{ storageStats.totalFiles }}</strong>
            </div>
            <div class="stat-box">
              <span class="muted">{{ t("nav.shares") }}</span>
              <strong>{{ storageStats.activeShares }}</strong>
            </div>
          </div>
        </template>
      </section>

      <!-- Admin Site Config -->
      <section v-if="canManageConfig" class="panel wide">
        <header>
          <div class="panel-title">
            <Shield :size="18" />
            <h2>{{ t("profile.siteConfig") }}</h2>
          </div>
          <button v-if="config" class="button small" type="button" @click="saveConfig">
            <Save :size="15" />
            {{ t("common.save") }}
          </button>
          <Loader2 v-else-if="loadingConfig" class="spin muted" :size="15" />
        </header>

        <div v-if="loadingConfig && !config" class="card-loading">
          <Loader2 class="spin" :size="18" />
          <span>{{ t("common.loading") }}</span>
        </div>

        <div v-else-if="config" class="form-grid">
          <label class="span-2">
            <span>{{ t("profile.adminContact") }}</span>
            <input v-model.trim="config.adminContact" class="input" placeholder="admin@example.com" />
          </label>
          <label>
            <span>{{ t("profile.shareDefaultTtl") }}</span>
            <input v-model.number="config.share.defaultTtlSec" class="input" type="number" min="60" />
          </label>
          <label>
            <span>{{ t("profile.shareMaxTtl") }}</span>
            <input v-model.number="config.share.memberMaxTtlSec" class="input" type="number" min="60" />
          </label>
          <label class="switch-row">
            <input v-model="config.storageGuardrail.hardLimitEnabled" type="checkbox" />
            <span>{{ t("profile.guardrailEnabled") }}</span>
          </label>
          <label>
            <span>{{ t("profile.guardrailHardGb") }}</span>
            <input v-model.trim="hardLimitGb" class="input" type="number" step="0.1" min="0.5" max="10" />
          </label>
          <label class="switch-row span-2">
            <input v-model="config.github.enabled" type="checkbox" />
            <span>{{ t("profile.githubEnabled") }}</span>
          </label>
          <label class="span-2">
            <span>{{ t("profile.githubCallbackUrl") }}</span>
            <div class="copy-input-row">
              <input :value="githubCallbackUrl" class="input mono-input" readonly />
              <button class="ghost-button small" type="button" @click="copyCallbackUrl">
                <Check v-if="copiedCallback" :size="14" />
                <Copy v-else :size="14" />
                {{ copiedCallback ? t("common.copied") : t("common.copy") }}
              </button>
            </div>
          </label>
          <label>
            <span>{{ t("profile.githubClientId") }}</span>
            <input v-model.trim="config.github.clientId" class="input" />
          </label>
          <label>
            <span>{{ t("profile.githubClientSecret") }}</span>
            <input v-model.trim="config.github.clientSecret" class="input" type="password" />
          </label>
          <label class="switch-row span-2">
            <input v-model="config.turnstile.enabled" type="checkbox" />
            <span>{{ t("profile.turnstileEnabled") }}</span>
          </label>
          <label>
            <span>{{ t("profile.turnstileSiteKey") }}</span>
            <input v-model.trim="config.turnstile.siteKey" class="input" />
          </label>
          <label>
            <span>{{ t("profile.turnstileSecretKey") }}</span>
            <input v-model.trim="config.turnstile.secretKey" class="input" type="password" />
          </label>
        </div>
      </section>
    </div>

    <!-- Set / Change Password Dialog -->
    <UiDialog v-model="passwordDialogOpen" width="400px" align-center>
      <template #header>
        <div class="dialog-title">
          <KeyRound :size="18" />
          <span>{{ auth.user?.hasPassword ? t("profile.changePassword") : t("profile.setPassword") }}</span>
        </div>
      </template>

      <form id="password-form" class="dialog-form" @submit.prevent="submitPassword">
        <label v-if="auth.user?.hasPassword">
          <span>{{ t("profile.currentPassword") }}</span>
          <input v-model="currentPassword" class="input" type="password" required />
        </label>
        <label v-else>
          <span>{{ t("profile.usernameOptional") }}</span>
          <input v-model.trim="nextUsername" class="input" minlength="3" maxlength="32" />
        </label>
        <label>
          <span>{{ t("profile.newPassword") }}</span>
          <input v-model="newPassword" class="input" type="password" minlength="8" required />
        </label>
      </form>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="passwordDialogOpen = false">
            {{ t("common.cancel") }}
          </button>
          <button class="button" type="submit" form="password-form" :disabled="savingPassword">
            {{ t("common.save") }}
          </button>
        </div>
      </template>
    </UiDialog>

    <HelpDialog v-model="helpOpen" />
  </main>
</template>

<style scoped>
.profile-page {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 18px 0 32px;
  display: grid;
  gap: 16px;
}

.profile-band {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.identity {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.identity img,
.avatar {
  width: 46px;
  height: 46px;
  border-radius: 8px;
  flex-shrink: 0;
}

.avatar {
  display: grid;
  place-items: center;
  background: var(--surface-hover);
  color: var(--accent);
  font-weight: 800;
  text-transform: uppercase;
}

.identity-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.identity h1 {
  margin: 0;
  font-size: 18px;
}

.identity p {
  margin: 2px 0 0;
  font-size: 13px;
}

.role-badge {
  border-radius: 6px;
  background: var(--surface-hover);
  color: var(--accent-2);
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 650;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  gap: 12px;
}

.panel.wide {
  grid-column: 1 / -1;
}

.panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 10px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel h2 {
  margin: 0;
  font-size: 15px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
}

.setting-row strong {
  font-size: 13px;
}

.setting-row p {
  margin: 2px 0 0;
  font-size: 12px;
}

.link-btn {
  text-decoration: none;
}

.small {
  min-height: 30px;
  font-size: 12px;
  padding: 0 10px;
}

.storage-panel {
  align-content: start;
}

.card-loading {
  min-height: 112px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}

.storage-summary {
  font-size: 13px;
}

.progress-track {
  height: 6px;
  border-radius: 999px;
  background: var(--surface-strong);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 260ms var(--ease-out);
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stat-box {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
  padding: 10px 8px;
  display: grid;
  justify-items: center;
  gap: 4px;
  font-size: 12px;
}

.stat-box strong {
  font-size: 15px;
  color: var(--text);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 16px;
}

.form-grid label,
.dialog-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}

.dialog-form {
  display: grid;
  gap: 12px;
}

.span-2 {
  grid-column: 1 / -1;
}

.switch-row {
  display: flex !important;
  align-items: center;
  gap: 8px;
  color: var(--text) !important;
}

.copy-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.mono-input {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 760px) {
  .profile-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
