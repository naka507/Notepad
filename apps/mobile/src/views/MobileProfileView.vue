<script setup lang="ts">
import type { DeviceSessionSummary, ShareLink, UserStorageSummary } from "@notepad/core"
import {
  ArrowLeft,
  Ban,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  GitBranch,
  HardDrive,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  StickyNote,
  User as UserIcon
} from "@lucide/vue"
import HelpDialog from "@web/components/HelpDialog.vue"
import LocaleSwitcher from "@web/components/LocaleSwitcher.vue"
import ThemeToggle from "@web/components/ThemeToggle.vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, ref, watch } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { currentLocale as locale, formatDateTime, t } from "@/i18n"
import { copyToClipboard, hapticImpact, openExternalUrl } from "@/native/bridge"
import { useAuthStore } from "@/stores/auth"
import { useLockStore, type LockScope } from "@/stores/lock"
import { useSyncStore } from "@/stores/sync"
import { formatBytes, formatRemainingTime } from "@/utils/format"

type SubPage = null | "shares" | "devices" | "security" | "account"

const emit = defineEmits<{
  "detail-change": [open: boolean]
  logout: []
}>()

const auth = useAuthStore()
const sync = useSyncStore()
const lock = useLockStore()

const subPage = ref<SubPage>(null)
const helpOpen = ref(false)

const userStorage = ref<UserStorageSummary | null>(null)
const loadingStorage = ref(true)

const shares = ref<ShareLink[]>([])
const loadingShares = ref(false)
const copiedShareId = ref("")

const devices = ref<DeviceSessionSummary[]>([])
const loadingDevices = ref(false)

// Security / Biometric PIN setup
const lockScopeDraft = ref<Exclude<LockScope, "off">>("totp")
const pinInput = ref("")
const pinConfirm = ref("")
const useBiometricDraft = ref(true)
const securityError = ref("")

// Account password forms
const newUsername = ref("")
const newPassword = ref("")
const currentPassword = ref("")
const nextPassword = ref("")
const savingAccount = ref(false)

const canShare = computed(() => auth.can("share:manage"))
const githubAccount = computed(() => auth.user?.linkedAccounts.find((a) => a.provider === "github") ?? null)

const storagePercent = computed(() => {
  if (!userStorage.value || userStorage.value.containerLimitBytes <= 0) return 0
  const usedContainer = Math.max(0, userStorage.value.containerLimitBytes - userStorage.value.containerAvailableBytes)
  return Math.min(100, Math.round((usedContainer / userStorage.value.containerLimitBytes) * 100))
})

watch(
  () => subPage.value !== null,
  (open) => emit("detail-change", open),
  { immediate: true }
)

function closeSubPage() {
  subPage.value = null
}

function openSubPage(page: Exclude<SubPage, null>) {
  void hapticImpact("light")
  subPage.value = page
  if (page === "shares") void loadShares()
  if (page === "devices") void loadDevices()
  if (page === "security") {
    securityError.value = ""
    pinInput.value = ""
    pinConfirm.value = ""
    lockScopeDraft.value = lock.scope === "app" ? "app" : "totp"
    useBiometricDraft.value = lock.biometricAvailable
  }
}

async function loadStorage() {
  loadingStorage.value = true
  try {
    userStorage.value = (await api.userStorageSummary()).summary
  } catch {
    userStorage.value = null
  } finally {
    loadingStorage.value = false
  }
}

async function loadShares() {
  loadingShares.value = true
  try {
    shares.value = (await api.listShares()).shares
  } finally {
    loadingShares.value = false
  }
}

async function copyShareLink(share: ShareLink) {
  await copyToClipboard(`${api.serverUrl}/s/${share.shareCode}`)
  void hapticImpact("medium")
  copiedShareId.value = share.id
  ElMessage.success(t("common.copied"))
  window.setTimeout(() => {
    if (copiedShareId.value === share.id) copiedShareId.value = ""
  }, 1500)
}

async function revokeShare(share: ShareLink) {
  const confirmed = await confirmDialog({
    title: t("share.revoke"),
    message: t("share.confirmRevoke"),
    confirmText: t("share.revoke"),
    tone: "danger"
  })
  if (!confirmed) return
  await api.revokeShare(share.id)
  await loadShares()
}

async function loadDevices() {
  loadingDevices.value = true
  try {
    devices.value = (await api.listDevices()).devices
  } finally {
    loadingDevices.value = false
  }
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
    emit("logout")
    return
  }
  await loadDevices()
}

async function saveLockSetup() {
  securityError.value = ""
  if (!/^\d{4,6}$/.test(pinInput.value)) {
    securityError.value = locale.value === "zh-CN" ? "请输入 4 至 6 位数字 PIN 码" : "Enter a 4–6 digit PIN"
    return
  }
  if (pinInput.value !== pinConfirm.value) {
    securityError.value = locale.value === "zh-CN" ? "两次输入的 PIN 码不一致" : "PIN codes do not match"
    return
  }
  await lock.enableLock(lockScopeDraft.value, pinInput.value, useBiometricDraft.value)
  pinInput.value = ""
  pinConfirm.value = ""
  ElMessage.success(locale.value === "zh-CN" ? "已启用应用锁保护" : "Lock enabled")
}

async function disableLock() {
  await lock.disableLock()
  ElMessage.success(locale.value === "zh-CN" ? "已关闭应用锁" : "Lock disabled")
}

async function submitSetPassword() {
  savingAccount.value = true
  try {
    await api.setPassword({
      password: newPassword.value,
      ...(newUsername.value.trim() ? { username: newUsername.value.trim() } : {})
    })
    newPassword.value = ""
    await auth.refreshSession()
    ElMessage.success(t("profile.passwordUpdated"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed")
  } finally {
    savingAccount.value = false
  }
}

async function submitChangePassword() {
  savingAccount.value = true
  try {
    await api.changePassword({
      currentPassword: currentPassword.value,
      newPassword: nextPassword.value
    })
    currentPassword.value = ""
    nextPassword.value = ""
    ElMessage.success(t("profile.passwordUpdated"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed")
  } finally {
    savingAccount.value = false
  }
}

async function unbindGithub() {
  const confirmed = await confirmDialog({
    title: t("profile.unbindGithub"),
    message: t("profile.confirmUnbind"),
    confirmText: t("profile.unbindGithub"),
    tone: "danger"
  })
  if (!confirmed) return
  try {
    await api.unbindGithub()
    await auth.refreshSession()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed")
  }
}

async function triggerSync() {
  void hapticImpact("light")
  await sync.pull()
  ElMessage.success(locale.value === "zh-CN" ? "同步完成" : "Synced")
}

async function confirmLogout() {
  const confirmed = await confirmDialog({
    title: t("nav.logout"),
    message: locale.value === "zh-CN" ? "确定退出当前账号？" : "Sign out of this device?",
    confirmText: t("nav.logout"),
    tone: "danger"
  })
  if (!confirmed) return
  emit("logout")
}

function lockStatusLabel(): string {
  if (lock.scope === "off") return locale.value === "zh-CN" ? "未开启" : "Off"
  if (lock.scope === "totp") return locale.value === "zh-CN" ? "保护动态码" : "2FA Only"
  return locale.value === "zh-CN" ? "全应用保护" : "Full App"
}

onMounted(() => {
  newUsername.value = auth.user?.username ?? ""
  void loadStorage()
})

defineExpose({
  closeDetail: closeSubPage,
  hasOpenDetail: () => subPage.value !== null
})
</script>

<template>
  <div class="m-profile-shell">
    <!-- ROOT PROFILE LIST (Identical experience for member & admin — no admin settings on mobile) -->
    <template v-if="subPage === null">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <UserIcon :size="19" />
            <h1 class="mobile-topbar-title">{{ locale === "zh-CN" ? "我的" : "Me" }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <button class="m-icon-btn" type="button" :title="locale === 'zh-CN' ? '立即同步' : 'Sync'" @click="triggerSync">
              <RefreshCw :class="{ spin: sync.syncing }" :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div class="mobile-scroll">
        <div class="profile-stack">
          <!-- Identity Card -->
          <section class="m-card id-card">
            <div class="id-avatar">{{ (auth.user?.username || "U").slice(0, 1).toUpperCase() }}</div>
            <div class="id-meta">
              <strong>{{ auth.user?.username }}</strong>
              <div class="id-sub">
                <span class="role-pill">{{ t(`role.${auth.user?.role ?? "pending"}`) }}</span>
                <span class="sync-note">
                  <Cloud :size="12" />
                  {{
                    sync.syncing
                      ? locale === "zh-CN"
                        ? "同步中…"
                        : "Syncing…"
                      : sync.lastSyncedAt
                        ? formatDateTime(sync.lastSyncedAt)
                        : locale === "zh-CN"
                          ? "已连接"
                          : "Connected"
                  }}
                </span>
              </div>
            </div>
          </section>

          <!-- Personal Storage Container Card -->
          <section class="m-card storage-card">
            <div class="storage-head">
              <span class="storage-title">
                <HardDrive :size="15" />
                {{ t("profile.storage") }}
              </span>
              <Loader2 v-if="loadingStorage" class="spin" :size="14" />
              <span v-else-if="userStorage" class="muted mono-num">
                {{ t("profile.containerAvailable") }}: {{ formatBytes(userStorage.containerAvailableBytes) }}
              </span>
            </div>
            <template v-if="userStorage">
              <div class="storage-track">
                <div class="storage-fill" :style="{ width: `${Math.max(storagePercent, 2)}%` }" />
              </div>
              <div class="storage-foot muted">
                <span>{{ t("profile.usedStorage") }}: {{ formatBytes(userStorage.usedBytes) }}</span>
                <span>{{ formatBytes(userStorage.containerAvailableBytes) }} / {{ formatBytes(userStorage.containerLimitBytes) }}</span>
              </div>
            </template>
          </section>

          <!-- Navigation Group -->
          <section class="m-card cell-group">
            <button v-if="canShare" class="cell-row" type="button" @click="openSubPage('shares')">
              <span class="cell-left">
                <Link2 :size="17" />
                {{ t("nav.shares") }}
              </span>
              <ChevronRight :size="16" class="muted" />
            </button>

            <button class="cell-row" type="button" @click="openSubPage('devices')">
              <span class="cell-left">
                <Smartphone :size="17" />
                {{ t("profile.devices") }}
              </span>
              <ChevronRight :size="16" class="muted" />
            </button>

            <button class="cell-row" type="button" @click="openSubPage('security')">
              <span class="cell-left">
                <Fingerprint :size="17" />
                {{ locale === "zh-CN" ? "生物识别与锁屏" : "Biometric & Lock" }}
              </span>
              <span class="cell-right">
                <span class="muted">{{ lockStatusLabel() }}</span>
                <ChevronRight :size="16" class="muted" />
              </span>
            </button>

            <button class="cell-row" type="button" @click="openSubPage('account')">
              <span class="cell-left">
                <KeyRound :size="17" />
                {{ t("profile.security") }}
              </span>
              <ChevronRight :size="16" class="muted" />
            </button>
          </section>

          <!-- Preferences Group -->
          <section class="m-card cell-group">
            <div class="cell-row static-row">
              <span class="cell-left">{{ locale === "zh-CN" ? "外观主题" : "Appearance" }}</span>
              <ThemeToggle />
            </div>
            <div class="cell-row static-row">
              <span class="cell-left">{{ locale === "zh-CN" ? "界面语言" : "Language" }}</span>
              <LocaleSwitcher />
            </div>
            <button class="cell-row" type="button" @click="helpOpen = true">
              <span class="cell-left">
                <BookOpen :size="17" />
                {{ t("help.title") }}
              </span>
              <ChevronRight :size="16" class="muted" />
            </button>
          </section>

          <p class="server-foot muted">{{ auth.serverUrl }}</p>

          <button class="danger-button logout-btn" type="button" @click="confirmLogout">
            <LogOut :size="16" />
            {{ t("nav.logout") }}
          </button>
        </div>
      </div>

      <!-- Consistent member/non-admin help dialog on mobile -->
      <HelpDialog v-model="helpOpen" :hide-admin-sections="true" />
    </template>

    <!-- SUB-PAGE: MY SHARES -->
    <template v-else-if="subPage === 'shares'">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeSubPage">
              <ArrowLeft :size="20" />
            </button>
            <h1 class="mobile-topbar-title">{{ t("nav.shares") }}</h1>
          </div>
          <button class="m-icon-btn" type="button" @click="loadShares">
            <RefreshCw :class="{ spin: loadingShares }" :size="17" />
          </button>
        </div>
      </header>

      <div class="mobile-scroll">
        <div v-if="loadingShares" class="m-empty"><Loader2 class="spin" :size="20" /></div>
        <div v-else-if="!shares.length" class="m-empty">{{ t("share.empty") }}</div>
        <div v-else class="sub-list">
          <article v-for="share in shares" :key="share.id" class="m-card sub-item" :class="{ faded: !share.isActive }">
            <div class="sub-item-top">
              <StickyNote v-if="share.targetType === 'note'" :size="15" />
              <FileText v-else-if="share.targetType === 'document' && share.targetDocType === 'doc'" :size="15" />
              <FileSpreadsheet v-else-if="share.targetType === 'document'" :size="15" />
              <FileIcon v-else :size="15" />
              <strong class="sub-title">{{ share.targetTitle }}</strong>
              <span class="status-pill" :class="{ active: share.isActive }">
                {{ share.isActive ? formatRemainingTime(share.expiresAt) : share.revokedAt ? t("share.revoked") : t("share.expired") }}
              </span>
            </div>
            <p class="muted sub-meta">
              {{ formatDateTime(share.createdAt) }} · {{ t("share.views", { count: share.viewCount }) }}
            </p>
            <div v-if="share.isActive" class="sub-actions">
              <button class="ghost-button tiny-btn" type="button" @click="copyShareLink(share)">
                <Check v-if="copiedShareId === share.id" :size="13" />
                <Copy v-else :size="13" />
                {{ copiedShareId === share.id ? t("common.copied") : t("common.copy") }}
              </button>
              <button class="danger-button tiny-btn" type="button" @click="revokeShare(share)">
                <Ban :size="13" />
                {{ t("share.revoke") }}
              </button>
            </div>
          </article>
        </div>
      </div>
    </template>

    <!-- SUB-PAGE: ACTIVE DEVICES -->
    <template v-else-if="subPage === 'devices'">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeSubPage">
              <ArrowLeft :size="20" />
            </button>
            <h1 class="mobile-topbar-title">{{ t("profile.devices") }}</h1>
          </div>
          <button class="m-icon-btn" type="button" @click="loadDevices">
            <RefreshCw :class="{ spin: loadingDevices }" :size="17" />
          </button>
        </div>
      </header>

      <div class="mobile-scroll">
        <div v-if="loadingDevices" class="m-empty"><Loader2 class="spin" :size="20" /></div>
        <div v-else-if="!devices.length" class="m-empty">{{ t("profile.noDevices") }}</div>
        <div v-else class="sub-list">
          <article v-for="dev in devices" :key="dev.id" class="m-card dev-row">
            <div class="dev-left">
              <Smartphone v-if="dev.platform === 'ios' || dev.platform === 'android' || dev.platform === 'mobile'" :size="17" />
              <Monitor v-else :size="17" />
              <div class="dev-meta">
                <div class="dev-title">
                  <strong>{{ dev.deviceName }}</strong>
                  <span v-if="dev.isCurrent" class="status-pill active">{{ t("profile.currentDevice") }}</span>
                </div>
                <span class="muted sub-meta">{{ dev.platform }} · {{ formatDateTime(dev.lastSeenAt) }}</span>
              </div>
            </div>
            <button class="danger-button tiny-btn" type="button" @click="revokeDevice(dev)">
              {{ t("profile.revokeDevice") }}
            </button>
          </article>
        </div>
      </div>
    </template>

    <!-- SUB-PAGE: BIOMETRIC & PIN VAULT LOCK -->
    <template v-else-if="subPage === 'security'">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeSubPage">
              <ArrowLeft :size="20" />
            </button>
            <h1 class="mobile-topbar-title">{{ locale === "zh-CN" ? "生物识别与锁屏" : "Biometric & Lock" }}</h1>
          </div>
        </div>
      </header>

      <div class="mobile-scroll">
        <div class="profile-stack">
          <section class="m-card sec-card">
            <div class="sec-head">
              <ShieldCheck :size="18" />
              <strong>{{ locale === "zh-CN" ? "本地隐私锁" : "Local Privacy Lock" }}</strong>
              <span class="status-pill" :class="{ active: lock.scope !== 'off' }">{{ lockStatusLabel() }}</span>
            </div>
            <p class="muted sec-desc">
              {{
                locale === "zh-CN"
                  ? "保护 2FA 动态码保险箱或整个应用，切至后台后自动上锁。"
                  : "Protect your 2FA vault or the entire app; locks automatically when backgrounded."
              }}
            </p>

            <template v-if="lock.scope !== 'off'">
              <div class="m-segmented">
                <button
                  :class="{ active: lock.scope === 'totp' }"
                  type="button"
                  @click="lock.updateScope('totp')"
                >
                  {{ locale === "zh-CN" ? "仅动态码" : "2FA Only" }}
                </button>
                <button
                  :class="{ active: lock.scope === 'app' }"
                  type="button"
                  @click="lock.updateScope('app')"
                >
                  {{ locale === "zh-CN" ? "整个应用" : "Full App" }}
                </button>
              </div>
              <div class="sec-actions">
                <button class="ghost-button" type="button" @click="lock.lockNow()">
                  <Lock :size="15" />
                  {{ locale === "zh-CN" ? "立即锁定测试" : "Lock Now" }}
                </button>
                <button class="danger-button" type="button" @click="disableLock">
                  {{ locale === "zh-CN" ? "关闭应用锁" : "Disable Lock" }}
                </button>
              </div>
            </template>

            <form v-else class="sec-form" @submit.prevent="saveLockSetup">
              <div class="m-segmented">
                <button
                  :class="{ active: lockScopeDraft === 'totp' }"
                  type="button"
                  @click="lockScopeDraft = 'totp'"
                >
                  {{ locale === "zh-CN" ? "保护动态码" : "Protect 2FA" }}
                </button>
                <button
                  :class="{ active: lockScopeDraft === 'app' }"
                  type="button"
                  @click="lockScopeDraft = 'app'"
                >
                  {{ locale === "zh-CN" ? "保护整个应用" : "Protect App" }}
                </button>
              </div>

              <label>
                <span>{{ locale === "zh-CN" ? "设置 4~6 位数字 PIN 码" : "Set 4–6 Digit PIN" }}</span>
                <input
                  v-model="pinInput"
                  class="input"
                  type="password"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="••••"
                  required
                />
              </label>

              <label>
                <span>{{ locale === "zh-CN" ? "确认 PIN 码" : "Confirm PIN" }}</span>
                <input
                  v-model="pinConfirm"
                  class="input"
                  type="password"
                  inputmode="numeric"
                  maxlength="6"
                  placeholder="••••"
                  required
                />
              </label>

              <label v-if="lock.biometricAvailable" class="check-row">
                <input v-model="useBiometricDraft" type="checkbox" />
                <span>{{ locale === "zh-CN" ? "同时允许面容 / 指纹生物识别解锁" : "Allow Face ID / Fingerprint unlock" }}</span>
              </label>

              <p v-if="securityError" class="err-text">{{ securityError }}</p>

              <button class="button" type="submit">
                <Lock :size="15" />
                {{ locale === "zh-CN" ? "启用锁屏保护" : "Enable Lock" }}
              </button>
            </form>
          </section>
        </div>
      </div>
    </template>

    <!-- SUB-PAGE: ACCOUNT & PASSWORD -->
    <template v-else-if="subPage === 'account'">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeSubPage">
              <ArrowLeft :size="20" />
            </button>
            <h1 class="mobile-topbar-title">{{ t("profile.security") }}</h1>
          </div>
        </div>
      </header>

      <div class="mobile-scroll">
        <div class="profile-stack">
          <section class="m-card sec-card">
            <div class="sec-head">
              <GitBranch :size="17" />
              <strong>GitHub</strong>
            </div>
            <p class="muted sec-desc">
              {{
                githubAccount
                  ? githubAccount.providerLogin
                    ? `@${githubAccount.providerLogin}`
                    : githubAccount.providerEmail || t("profile.bound")
                  : t("profile.unbound")
              }}
            </p>
            <button
              v-if="githubAccount"
              class="danger-button"
              type="button"
              :disabled="!auth.user?.hasPassword"
              @click="unbindGithub"
            >
              {{ t("profile.unbindGithub") }}
            </button>
            <button
              v-else-if="auth.siteConfig?.github.enabled"
              class="ghost-button"
              type="button"
              @click="openExternalUrl(api.githubBindUrl)"
            >
              <GitBranch :size="15" />
              {{ t("profile.bindGithub") }}
            </button>
          </section>

          <section v-if="!auth.user?.hasPassword" class="m-card sec-card">
            <div class="sec-head">
              <KeyRound :size="17" />
              <strong>{{ t("profile.setPassword") }}</strong>
            </div>
            <form class="sec-form" @submit.prevent="submitSetPassword">
              <label>
                <span>{{ t("auth.username") }}</span>
                <input v-model.trim="newUsername" class="input" minlength="2" maxlength="32" />
              </label>
              <label>
                <span>{{ t("profile.newPassword") }}</span>
                <input v-model="newPassword" class="input" type="password" minlength="8" required />
              </label>
              <button class="button" type="submit" :disabled="savingAccount">{{ t("common.save") }}</button>
            </form>
          </section>

          <section v-else class="m-card sec-card">
            <div class="sec-head">
              <KeyRound :size="17" />
              <strong>{{ t("profile.changePassword") }}</strong>
            </div>
            <form class="sec-form" @submit.prevent="submitChangePassword">
              <label>
                <span>{{ t("profile.currentPassword") }}</span>
                <input v-model="currentPassword" class="input" type="password" required />
              </label>
              <label>
                <span>{{ t("profile.newPassword") }}</span>
                <input v-model="nextPassword" class="input" type="password" minlength="8" required />
              </label>
              <button class="button" type="submit" :disabled="savingAccount">{{ t("common.save") }}</button>
            </form>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.m-profile-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.profile-stack {
  display: grid;
  gap: 12px;
}

.id-card {
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 13px;
}

.id-avatar {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 20px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.id-meta {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.id-meta strong {
  font-size: 17px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.id-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.role-pill,
.status-pill {
  font-size: 11px;
  font-weight: 650;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--muted);
}

.status-pill.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.sync-note {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}

.storage-card {
  padding: 14px;
  display: grid;
  gap: 9px;
}

.storage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.storage-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 650;
}

.mono-num {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
}

.storage-track {
  height: 6px;
  border-radius: 999px;
  background: var(--panel-2);
  overflow: hidden;
}

.storage-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}

.storage-foot {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.cell-group {
  overflow: hidden;
}

.cell-row {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 14px;
  cursor: pointer;
}

.cell-row:last-child {
  border-bottom: 0;
}

.cell-row:not(.static-row):active {
  background: var(--surface-hover);
}

.static-row {
  cursor: default;
}

.cell-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.cell-right {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.server-foot {
  margin: 2px 0 0;
  text-align: center;
  font-size: 11px;
}

.logout-btn {
  width: 100%;
  min-height: 44px;
  border-radius: 12px;
}

.sub-list {
  display: grid;
  gap: 10px;
}

.sub-item {
  padding: 13px 14px;
  display: grid;
  gap: 6px;
}

.sub-item.faded {
  opacity: 0.65;
}

.sub-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sub-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}

.sub-meta {
  margin: 0;
  font-size: 12px;
}

.sub-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.tiny-btn {
  min-height: 30px;
  font-size: 12px;
  padding: 0 10px;
}

.dev-row {
  padding: 13px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.dev-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.dev-meta {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.dev-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dev-title strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sec-card {
  padding: 15px;
  display: grid;
  gap: 12px;
}

.sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}

.sec-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.sec-form {
  display: grid;
  gap: 10px;
}

.sec-form label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.check-row {
  display: flex !important;
  align-items: center;
  gap: 8px;
  color: var(--ink) !important;
  font-size: 13px !important;
}

.sec-actions {
  display: grid;
  gap: 8px;
}

.err-text {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
</style>
