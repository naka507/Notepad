<script setup lang="ts">
import {
  PERMISSIONS,
  type DeviceSessionSummary,
  type SiteConfig,
  type StorageStats,
  type UserStorageSummary
} from "@notepad/core"
import {
  BookOpen,
  Check,
  Copy,
  Globe,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  Monitor,
  Save,
  Server,
  Shield,
  Smartphone,
  Unlink
} from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, ref, type Component } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import HelpDialog from "@web/components/HelpDialog.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { formatBytes } from "@/utils/format"

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()

const config = ref<SiteConfig | null>(null)
const storageStats = ref<StorageStats | null>(null)
const userStorage = ref<UserStorageSummary | null>(null)
const devices = ref<DeviceSessionSummary[]>([])
const loadingConfig = ref(true)
const loadingStorage = ref(false)
const loadingDevices = ref(true)
const helpOpen = ref(false)
const passwordDialogOpen = ref(false)
const currentPassword = ref("")
const newPassword = ref("")
const nextUsername = ref("")
const savingPassword = ref(false)
const hardLimitGb = ref("9.8")
const copiedCallback = ref(false)

const canManageConfig = computed(() => auth.hasPermission(PERMISSIONS.CONFIG_MANAGE))
const canViewPersonalStorage = computed(
  () => !canManageConfig.value && auth.hasPermission(PERMISSIONS.FILE_MANAGE)
)
const showStorageCard = computed(() => canManageConfig.value || canViewPersonalStorage.value)
const githubAccount = computed(
  () => auth.user?.linkedAccounts.find((a) => a.provider === "github") ?? null
)
const githubCallbackUrl = computed(() => `${auth.serverUrl}/api/auth/github/callback`)
const storageRatio = computed(() => {
  if (!storageStats.value?.freeTierLimitBytes) return 0
  return Math.min(100, Math.round((storageStats.value.totalBytes / storageStats.value.freeTierLimitBytes) * 100))
})
const userQuotaRatio = computed(() => {
  if (!userStorage.value?.maxFileCount) return 0
  return Math.min(100, Math.round((userStorage.value.usedFileCount / userStorage.value.maxFileCount) * 100))
})

async function copyCallbackUrl() {
  await navigator.clipboard.writeText(githubCallbackUrl.value)
  copiedCallback.value = true
  window.setTimeout(() => {
    copiedCallback.value = false
  }, 1500)
}

async function loadData() {
  loadingConfig.value = true
  loadingStorage.value = showStorageCard.value
  loadingDevices.value = true

  await Promise.all([
    api
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
      }),
    canManageConfig.value
      ? api.storageStats().then((r) => (storageStats.value = r.stats)).finally(() => (loadingStorage.value = false))
      : canViewPersonalStorage.value
        ? api.userStorageSummary().then((r) => (userStorage.value = r.summary)).finally(() => (loadingStorage.value = false))
        : Promise.resolve(),
    api.listDevices().then((r) => (devices.value = r.devices)).catch(() => {}).finally(() => (loadingDevices.value = false))
  ])
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
      await api.changePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value })
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
  await api.unbindGithub()
  await auth.loadSession()
}

async function revokeDevice(device: DeviceSessionSummary) {
  const confirmed = await confirmDialog({
    title: t("profile.revokeDevice"),
    message: t("profile.confirmRevokeDevice", { name: device.deviceName }),
    confirmText: t("profile.revokeDevice"),
    tone: "danger"
  })
  if (!confirmed) return
  await api.revokeDevice(device.id)
  if (device.isCurrent) {
    await auth.logout()
    return
  }
  devices.value = devices.value.filter((d) => d.id !== device.id)
}

async function saveConfig() {
  if (!config.value) return
  const parsedGb = Math.max(0.5, Number(hardLimitGb.value) || 9.8)
  const hardLimitBytes = Math.round(parsedGb * 1024 * 1024 * 1024)
  const softWarnBytes = Math.min(Math.round(hardLimitBytes * 0.92), hardLimitBytes)
  await api.updateConfig({
    ...config.value,
    storageGuardrail: { ...config.value.storageGuardrail, softWarnBytes, hardLimitBytes }
  })
  ElMessage.success(t("profile.configSaved"))
  await loadData()
}

onMounted(loadData)
</script>

<template>
  <div class="desktop-scroll-page">
    <div class="profile-stack">
      <section class="profile-band">
        <div class="identity">
          <img v-if="auth.user?.avatarUrl" :src="auth.user.avatarUrl" alt="" />
          <div v-else class="avatar">{{ auth.user?.name?.[0] || auth.user?.username?.[0] || "N" }}</div>
          <div>
            <div class="identity-title">
              <h1>{{ auth.user?.name || auth.user?.username }}</h1>
              <span class="role-badge">{{ t(`role.${auth.user?.role ?? "pending"}`) }}</span>
            </div>
            <p class="muted server-line"><Server :size="12" />{{ auth.serverUrl }}</p>
          </div>
        </div>
        <button class="ghost-button small" type="button" @click="helpOpen = true">
          <BookOpen :size="14" />{{ t("profile.helpCard") }}
        </button>
      </section>

      <div class="profile-grid">
        <section class="panel" :class="{ wide: !showStorageCard }">
          <header>
            <div class="panel-title"><KeyRound :size="16" /><h2>{{ t("profile.security") }}</h2></div>
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
              <p class="muted">{{ githubAccount ? githubAccount.providerLogin || t("profile.bound") : t("profile.unbound") }}</p>
            </div>
            <button
              v-if="githubAccount"
              class="danger-button small"
              type="button"
              :disabled="!auth.user?.hasPassword"
              @click="unlinkGithub"
            >
              <Unlink :size="13" />{{ t("profile.unbindGithub") }}
            </button>
          </div>
        </section>

        <section v-if="showStorageCard" class="panel storage-panel">
          <header>
            <div class="panel-title"><HardDrive :size="16" /><h2>{{ t("profile.storage") }}</h2></div>
            <strong v-if="canManageConfig && storageStats" class="storage-summary">
              {{ formatBytes(storageStats.totalBytes) }} / {{ formatBytes(storageStats.freeTierLimitBytes) }}
            </strong>
            <strong v-else-if="canViewPersonalStorage && userStorage" class="storage-summary">
              {{
                userStorage.maxFileCount !== null
                  ? t("ws.quotaUsed", { count: userStorage.usedFileCount, max: userStorage.maxFileCount })
                  : t("ws.quotaUnlimited", { count: userStorage.usedFileCount })
              }}
            </strong>
            <Loader2 v-else-if="loadingStorage" class="spin muted" :size="15" />
          </header>

          <div v-if="loadingStorage && !storageStats && !userStorage" class="card-loading">
            <Loader2 class="spin" :size="18" /><span>{{ t("common.loading") }}</span>
          </div>

          <template v-else-if="canManageConfig && storageStats">
            <div class="progress-track"><div class="progress-fill" :style="{ width: `${storageRatio}%` }" /></div>
            <div class="stat-grid">
              <div class="stat-box"><span class="muted">{{ t("nav.users") }}</span><strong>{{ storageStats.totalUsers }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("nav.notes") }}</span><strong>{{ storageStats.totalNotes }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("nav.files") }}</span><strong>{{ storageStats.totalFiles }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("nav.shares") }}</span><strong>{{ storageStats.activeShares }}</strong></div>
            </div>
          </template>

          <template v-else-if="canViewPersonalStorage && userStorage">
            <div class="progress-track"><div class="progress-fill" :style="{ width: `${userQuotaRatio}%` }" /></div>
            <div class="stat-grid">
              <div class="stat-box"><span class="muted">{{ t("profile.maxFileSize") }}</span><strong>{{ userStorage.maxFileSize ? formatBytes(userStorage.maxFileSize) : "∞" }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("profile.remainingFiles") }}</span><strong>{{ userStorage.remainingFileCount ?? "∞" }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("profile.usedStorage") }}</span><strong>{{ formatBytes(userStorage.usedBytes) }}</strong></div>
              <div class="stat-box"><span class="muted">{{ t("profile.containerAvailable") }}</span><strong>{{ formatBytes(userStorage.containerAvailableBytes) }}</strong></div>
            </div>
            <p v-if="userStorage.lockedFileCount > 0" class="locked-notice">
              <Lock :size="13" /><span>{{ t("profile.lockedFilesNotice", { count: userStorage.lockedFileCount }) }}</span>
            </p>
          </template>
        </section>

        <section class="panel wide">
          <header>
            <div class="panel-title"><Monitor :size="16" /><h2>{{ t("profile.devices") }}</h2></div>
            <span class="muted small-txt">{{ devices.length }}</span>
          </header>
          <div v-if="loadingDevices && !devices.length" class="card-loading"><Loader2 class="spin" :size="18" /></div>
          <div v-else class="device-list">
            <div v-for="d in devices" :key="d.id" class="setting-row">
              <div class="device-main">
                <Smartphone v-if="d.platform === 'mobile' || d.platform === 'ios' || d.platform === 'android'" :size="15" class="muted" />
                <Monitor v-else-if="d.kind === 'device'" :size="15" class="muted" />
                <Globe v-else :size="15" class="muted" />
                <div>
                  <div class="identity-title">
                    <strong>{{ d.deviceName }}</strong>
                    <span v-if="d.isCurrent" class="role-badge">{{ t("profile.currentDevice") }}</span>
                  </div>
                  <p class="muted">{{ formatDateTime(d.lastSeenAt) }}</p>
                </div>
              </div>
              <button class="danger-button small" type="button" @click="revokeDevice(d)">{{ t("profile.revokeDevice") }}</button>
            </div>
          </div>
        </section>

        <section v-if="canManageConfig" class="panel wide">
          <header>
            <div class="panel-title"><Shield :size="16" /><h2>{{ t("profile.siteConfig") }}</h2></div>
            <button v-if="config" class="button small" type="button" @click="saveConfig">
              <Save :size="14" />{{ t("common.save") }}
            </button>
          </header>
          <div v-if="loadingConfig && !config" class="card-loading"><Loader2 class="spin" :size="18" /></div>
          <div v-else-if="config" class="form-grid">
            <label class="span-2"><span>{{ t("profile.adminContact") }}</span><input v-model.trim="config.adminContact" class="input" /></label>
            <label><span>{{ t("profile.shareDefaultTtl") }}</span><input v-model.number="config.share.defaultTtlSec" class="input" type="number" /></label>
            <label><span>{{ t("profile.shareMaxTtl") }}</span><input v-model.number="config.share.memberMaxTtlSec" class="input" type="number" /></label>
            <label class="switch-row"><input v-model="config.storageGuardrail.hardLimitEnabled" type="checkbox" /><span>{{ t("profile.guardrailEnabled") }}</span></label>
            <label><span>{{ t("profile.guardrailHardGb") }}</span><input v-model.trim="hardLimitGb" class="input" type="number" step="0.1" /></label>
            <label class="switch-row span-2"><input v-model="config.github.enabled" type="checkbox" /><span>{{ t("profile.githubEnabled") }}</span></label>
            <label class="span-2">
              <span>{{ t("profile.githubCallbackUrl") }}</span>
              <div class="copy-row">
                <input :value="githubCallbackUrl" class="input mono" readonly />
                <button class="ghost-button small" type="button" @click="copyCallbackUrl">
                  <Check v-if="copiedCallback" :size="13" /><Copy v-else :size="13" />
                  {{ copiedCallback ? t("common.copied") : t("common.copy") }}
                </button>
              </div>
            </label>
            <label><span>{{ t("profile.githubClientId") }}</span><input v-model.trim="config.github.clientId" class="input" /></label>
            <label><span>{{ t("profile.githubClientSecret") }}</span><input v-model.trim="config.github.clientSecret" class="input" type="password" /></label>
          </div>
        </section>
      </div>
    </div>

    <UiDialog v-model="passwordDialogOpen" width="380px" align-center>
      <template #header>
        <div class="dialog-title"><KeyRound :size="16" /><span>{{ auth.user?.hasPassword ? t("profile.changePassword") : t("profile.setPassword") }}</span></div>
      </template>
      <form id="desk-pw-form" class="dialog-form" @submit.prevent="submitPassword">
        <label v-if="auth.user?.hasPassword"><span>{{ t("profile.currentPassword") }}</span><input v-model="currentPassword" class="input" type="password" required /></label>
        <label v-else><span>{{ t("profile.usernameOptional") }}</span><input v-model.trim="nextUsername" class="input" /></label>
        <label><span>{{ t("profile.newPassword") }}</span><input v-model="newPassword" class="input" type="password" minlength="8" required /></label>
      </form>
      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="passwordDialogOpen = false">{{ t("common.cancel") }}</button>
          <button class="button" type="submit" form="desk-pw-form" :disabled="savingPassword">{{ t("common.save") }}</button>
        </div>
      </template>
    </UiDialog>

    <HelpDialog v-model="helpOpen" />
  </div>
</template>

<style scoped>
.profile-stack {
  display: grid;
  gap: 14px;
}

.profile-band,
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px 16px;
}

.profile-band {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.identity img,
.avatar {
  width: 42px;
  height: 42px;
  border-radius: 8px;
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
  font-size: 16px;
}

.server-line {
  margin: 3px 0 0;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.role-badge {
  border-radius: 6px;
  background: var(--surface-hover);
  color: var(--accent-2);
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 650;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.panel {
  display: grid;
  gap: 10px;
  align-content: start;
}

.panel.wide {
  grid-column: 1 / -1;
}

.panel header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding-bottom: 9px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
}

.panel h2 {
  margin: 0;
  font-size: 14px;
}

.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 7px;
}

.setting-row p {
  margin: 2px 0 0;
  font-size: 12px;
}

.small {
  min-height: 28px;
  font-size: 12px;
  padding: 0 10px;
}

.small-txt {
  font-size: 12px;
}

.storage-summary {
  font-size: 12px;
}

.card-loading {
  min-height: 90px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
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
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.stat-box {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
  padding: 9px 6px;
  display: grid;
  justify-items: center;
  gap: 3px;
  font-size: 11px;
}

.stat-box strong {
  font-size: 14px;
}

.locked-notice {
  margin: 0;
  padding: 7px 10px;
  border-radius: 6px;
  background: var(--warning-bg);
  color: var(--warning);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.device-list {
  display: grid;
  gap: 8px;
}

.device-main {
  display: flex;
  align-items: center;
  gap: 9px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.form-grid label,
.dialog-form label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.dialog-form {
  display: grid;
  gap: 11px;
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

.copy-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
