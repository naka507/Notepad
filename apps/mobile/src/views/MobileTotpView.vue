<script setup lang="ts">
import {
  generateTotpCode,
  parseOtpAuthUri,
  type Category,
  type TotpAlgorithm,
  type TotpEntry
} from "@notepad/core"
import {
  Check,
  Copy,
  ImagePlus,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2
} from "@lucide/vue"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue"
import { api } from "@/api/client"
import BiometricLockOverlay from "@/components/BiometricLockOverlay.vue"
import QrScannerSheet from "@/components/QrScannerSheet.vue"
import { confirmDialog } from "@/components/confirm"
import { currentLocale as locale, t } from "@/i18n"
import { copyToClipboard, hapticImpact } from "@/native/bridge"
import { useLockStore } from "@/stores/lock"
import { useSyncStore } from "@/stores/sync"
import { decodeQrImageFile } from "@/utils/qrDecode"

const UiDialog = ElDialog as unknown as Component
const sync = useSyncStore()
const lock = useLockStore()

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const selectedCategory = ref("all")
const totpView = ref<"archived" | "trash">("archived")
const searchQuery = ref("")
const showSearch = ref(false)
const loading = ref(false)
const entries = ref<TotpEntry[]>([])
const liveCodes = ref<Record<string, { code: string; remainingSec: number; period: number }>>({})
const copiedId = ref("")

const scannerOpen = ref(false)
const addDialogOpen = ref(false)
const addMode = ref<"manual" | "uri">("manual")
const saving = ref(false)
const decodingQr = ref(false)
const qrFileInput = ref<HTMLInputElement | null>(null)

const formIssuer = ref("")
const formAccount = ref("")
const formSecret = ref("")
const formAlgorithm = ref<TotpAlgorithm>("SHA1")
const formDigits = ref<6 | 8>(6)
const formPeriod = ref(30)
const formCategoryId = ref<string | null>(null)
const formUriBatch = ref("")

let tickTimer: number | null = null
let searchTimer: number | null = null

const isVaultLocked = computed(() => lock.isProtected("totp"))

function formatOtp(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}

function remainingFor(entry: TotpEntry): number {
  return liveCodes.value[entry.id]?.remainingSec ?? entry.period
}

function progressRatio(entry: TotpEntry): number {
  const period = liveCodes.value[entry.id]?.period || entry.period || 30
  return Math.max(0, Math.min(1, remainingFor(entry) / period))
}

function categoryName(categoryId: string | null): string {
  if (!categoryId) return t("common.defaultCategory")
  return categories.value.find((c) => c.id === categoryId)?.name ?? t("common.defaultCategory")
}

function issuerInitial(entry: TotpEntry): string {
  const label = (entry.issuer || entry.accountName || "?").trim()
  return label.slice(0, 1).toUpperCase()
}

async function refreshCodes() {
  const nowMs = Date.now()
  const next: Record<string, { code: string; remainingSec: number; period: number }> = {}
  await Promise.all(
    entries.value.map(async (entry) => {
      try {
        next[entry.id] = await generateTotpCode({
          secret: entry.secret,
          algorithm: entry.algorithm,
          digits: entry.digits,
          period: entry.period,
          timestamp: nowMs
        })
      } catch {
        next[entry.id] = { code: "------", remainingSec: entry.period, period: entry.period }
      }
    })
  )
  liveCodes.value = next
}

async function loadCategories() {
  try {
    const res = await api.listCategories("totp")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch {
    categories.value = sync.categories
      .filter((c) => c.scope === "totp" && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
  }
}

async function loadEntries() {
  loading.value = true
  try {
    const res = await api.listTotp({
      view: totpView.value,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value ? { q: searchQuery.value } : {})
    })
    entries.value = res.items
  } catch {
    const q = searchQuery.value.toLowerCase()
    entries.value = sync.totpEntries.filter((item) => {
      if (totpView.value === "trash" ? item.deletedAt === null : item.deletedAt !== null) return false
      if (selectedCategory.value === "uncategorized" && item.categoryId !== null) return false
      if (selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized" && item.categoryId !== selectedCategory.value) {
        return false
      }
      if (!q) return true
      return item.issuer.toLowerCase().includes(q) || item.accountName.toLowerCase().includes(q)
    })
  } finally {
    loading.value = false
    await refreshCodes()
  }
}

async function copyCode(entry: TotpEntry) {
  const code = liveCodes.value[entry.id]?.code
  if (!code || code === "------") return
  await copyToClipboard(code)
  void hapticImpact("medium")
  copiedId.value = entry.id
  ElMessage.success(t("common.copied"))
  window.setTimeout(() => {
    if (copiedId.value === entry.id) copiedId.value = ""
  }, 1500)
}

function openAddDialog(mode: "manual" | "uri" = "manual") {
  addMode.value = mode
  formIssuer.value = ""
  formAccount.value = ""
  formSecret.value = ""
  formAlgorithm.value = "SHA1"
  formDigits.value = 6
  formPeriod.value = 30
  formUriBatch.value = ""
  formCategoryId.value =
    selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
      ? selectedCategory.value
      : null
  addDialogOpen.value = true
}

async function handleQrScanned(uri: string) {
  scannerOpen.value = false
  try {
    const parsed = parseOtpAuthUri(uri)
    if (!parsed) {
      ElMessage.error(t("totp.qrInvalid"))
      return
    }
    const categoryId =
      selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
        ? selectedCategory.value
        : null
    await api.createTotp({
      issuer: parsed.issuer,
      accountName: parsed.accountName,
      secret: parsed.secret,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      categoryId
    })
    ElMessage.success(
      locale.value === "zh-CN"
        ? `已扫码导入 ${parsed.issuer || parsed.accountName}`
        : `Imported ${parsed.issuer || parsed.accountName}`
    )
    await Promise.all([loadCategories(), loadEntries(), sync.pull()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : t("totp.qrInvalid"))
  }
}

async function onQrImagePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  decodingQr.value = true
  try {
    const { parsed } = await decodeQrImageFile(file)
    if (!parsed) {
      ElMessage.error(t("totp.qrInvalid"))
      return
    }
    formIssuer.value = parsed.issuer
    formAccount.value = parsed.accountName
    formSecret.value = parsed.secret
    formAlgorithm.value = parsed.algorithm
    formDigits.value = parsed.digits
    formPeriod.value = parsed.period
    addMode.value = "manual"
    ElMessage.success(t("totp.qrParsed"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : t("totp.qrNotFound"))
  } finally {
    decodingQr.value = false
  }
}

async function submitAdd() {
  saving.value = true
  try {
    if (addMode.value === "manual") {
      await api.createTotp({
        issuer: formIssuer.value.trim(),
        accountName: formAccount.value.trim(),
        secret: formSecret.value.trim(),
        algorithm: formAlgorithm.value,
        digits: formDigits.value,
        period: formPeriod.value,
        categoryId: formCategoryId.value
      })
    } else {
      const uris = formUriBatch.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (!uris.length) return
      const res = await api.importTotp({ uris, categoryId: formCategoryId.value })
      ElMessage.success(t("totp.importedCount", { count: res.imported.length }))
    }
    addDialogOpen.value = false
    await Promise.all([loadCategories(), loadEntries(), sync.pull()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : t("totp.qrInvalid"))
  } finally {
    saving.value = false
  }
}

async function removeEntry(entry: TotpEntry) {
  const isTrash = totpView.value === "trash"
  const label = entry.issuer || entry.accountName
  const confirmed = await confirmDialog({
    title: isTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: isTrash ? t("ws.confirmPermanentDelete") : t("totp.confirmDelete", { name: label }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  if (isTrash) {
    await api.permanentDeleteTotp(entry.id)
  } else {
    await api.deleteTotp(entry.id)
  }
  await Promise.all([loadCategories(), loadEntries(), sync.pull()])
}

async function restoreEntry(entry: TotpEntry) {
  await api.restoreTotp(entry.id)
  await Promise.all([loadCategories(), loadEntries(), sync.pull()])
}

watch([selectedCategory, totpView], () => {
  void loadEntries()
})

watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadEntries(), 220)
})

onMounted(async () => {
  await Promise.all([loadCategories(), loadEntries()])
  tickTimer = window.setInterval(() => {
    void refreshCodes()
  }, 1000)
})

onBeforeUnmount(() => {
  if (tickTimer) window.clearInterval(tickTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
})
</script>

<template>
  <div class="m-totp-shell">
    <header class="mobile-topbar">
      <div class="mobile-topbar-inner">
        <div class="mobile-topbar-left">
          <ShieldCheck :size="19" />
          <h1 class="mobile-topbar-title">{{ t("nav.totp") }}</h1>
        </div>
        <div class="mobile-topbar-actions">
          <button
            v-if="lock.scope !== 'off'"
            class="m-icon-btn"
            type="button"
            :title="locale === 'zh-CN' ? '立即锁定' : 'Lock'"
            @click="lock.lockNow()"
          >
            <Lock :size="17" />
          </button>
          <button class="m-icon-btn" type="button" @click="showSearch = !showSearch">
            <Search :size="18" />
          </button>
          <button class="m-icon-btn" type="button" @click="loadEntries">
            <RefreshCw :class="{ spin: loading }" :size="17" />
          </button>
          <button class="m-pill-btn" type="button" @click="openAddDialog('manual')">
            <Plus :size="15" />
            {{ t("totp.add") }}
          </button>
        </div>
      </div>
    </header>

    <div class="m-totp-stage">
      <BiometricLockOverlay
        v-if="isVaultLocked"
        :title="locale === 'zh-CN' ? '动态码保险箱已锁定' : '2FA Vault Locked'"
      />

      <div class="mobile-scroll with-fab">
        <div class="totp-controls">
          <div class="totp-filter-row">
            <div class="cat-picker-box">
              <CategoryPicker
                v-model="selectedCategory"
                scope="totp"
                :categories="categories"
                :default-count="defaultCount"
                @changed="loadCategories(); loadEntries()"
              />
            </div>
            <div class="m-segmented totp-view-seg">
              <button :class="{ active: totpView === 'archived' }" type="button" @click="totpView = 'archived'">
                {{ t("ws.archived") }}
              </button>
              <button :class="{ active: totpView === 'trash' }" type="button" @click="totpView = 'trash'">
                {{ t("ws.trash") }}
              </button>
            </div>
          </div>

          <div v-if="showSearch" class="m-search-row">
            <Search :size="15" class="muted" />
            <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
          </div>
        </div>

        <div v-if="loading && !entries.length" class="m-empty">
          <Loader2 class="spin" :size="22" />
        </div>

        <div v-else-if="!entries.length" class="m-empty">
          <ShieldCheck :size="36" />
          <p>{{ t("totp.empty") }}</p>
          <div class="empty-actions">
            <button class="m-pill-btn" type="button" @click="scannerOpen = true">
              <ScanLine :size="15" />
              {{ locale === "zh-CN" ? "扫码录入" : "Scan QR" }}
            </button>
            <button class="m-pill-btn ghost" type="button" @click="openAddDialog('manual')">
              <Plus :size="15" />
              {{ t("totp.add") }}
            </button>
          </div>
        </div>

        <!-- Mobile Card-Style 2FA List -->
        <div v-else class="totp-card-list">
          <article
            v-for="entry in entries"
            :key="entry.id"
            class="m-card totp-card"
            :class="{ urgent: remainingFor(entry) <= 5, copied: copiedId === entry.id }"
            @click="totpView !== 'trash' ? copyCode(entry) : undefined"
          >
            <div class="card-top">
              <div class="issuer-badge">{{ issuerInitial(entry) }}</div>
              <div class="card-meta">
                <div class="card-title-row">
                  <strong>{{ entry.issuer || entry.accountName }}</strong>
                  <span class="cat-chip">{{ categoryName(entry.categoryId) }}</span>
                </div>
                <span class="account-sub">{{ entry.accountName }}</span>
              </div>

              <div class="card-actions" @click.stop>
                <button
                  v-if="totpView === 'trash'"
                  class="m-icon-btn"
                  type="button"
                  :title="t('ws.restore')"
                  @click="restoreEntry(entry)"
                >
                  <RotateCcw :size="16" />
                </button>
                <button
                  class="m-icon-btn danger-ico"
                  type="button"
                  :title="t('common.delete')"
                  @click="removeEntry(entry)"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
            </div>

            <div class="card-code-row">
              <span class="otp-big-code">
                {{ formatOtp(liveCodes[entry.id]?.code ?? "------") }}
              </span>

              <div class="otp-right">
                <span v-if="copiedId === entry.id" class="copied-tag">
                  <Check :size="13" />
                  {{ t("common.copied") }}
                </span>
                <span v-else class="countdown-pill" :class="{ urgent: remainingFor(entry) <= 5 }">
                  <Copy :size="12" />
                  {{ remainingFor(entry) }}s
                </span>
              </div>
            </div>

            <div class="card-progress">
              <div
                class="card-progress-fill"
                :class="{ urgent: remainingFor(entry) <= 5 }"
                :style="{ width: `${Math.round(progressRatio(entry) * 100)}%` }"
              />
            </div>
          </article>
        </div>
      </div>

      <!-- Primary Mobile QR Scan FAB -->
      <button
        v-if="totpView !== 'trash' && !isVaultLocked"
        class="mobile-fab"
        type="button"
        @click="scannerOpen = true"
      >
        <QrCode :size="18" />
        <span>{{ locale === "zh-CN" ? "扫码" : "Scan" }}</span>
      </button>
    </div>

    <QrScannerSheet :open="scannerOpen" @close="scannerOpen = false" @scanned="handleQrScanned" />

    <UiDialog v-model="addDialogOpen" align-center>
      <template #header>
        <div class="dialog-title">
          <KeyRound :size="17" />
          <span>{{ t("totp.add") }}</span>
        </div>
      </template>

      <div class="m-segmented dialog-seg">
        <button :class="{ active: addMode === 'manual' }" type="button" @click="addMode = 'manual'">
          <KeyRound :size="13" />
          {{ t("totp.modeManual") }}
        </button>
        <button :class="{ active: addMode === 'uri' }" type="button" @click="addMode = 'uri'">
          <Link2 :size="13" />
          {{ t("totp.modeUri") }}
        </button>
      </div>

      <form v-if="addMode === 'manual'" id="m-totp-form" class="totp-form" @submit.prevent="submitAdd">
        <div class="qr-row">
          <button class="ghost-button small-btn" type="button" @click="addDialogOpen = false; scannerOpen = true">
            <ScanLine :size="14" />
            {{ locale === "zh-CN" ? "相机扫码" : "Camera" }}
          </button>
          <button class="ghost-button small-btn" type="button" :disabled="decodingQr" @click="qrFileInput?.click()">
            <Loader2 v-if="decodingQr" class="spin" :size="14" />
            <ImagePlus v-else :size="14" />
            {{ t("totp.modeQr") }}
          </button>
          <input ref="qrFileInput" type="file" accept="image/*" hidden @change="onQrImagePicked" />
        </div>

        <label>
          <span>{{ t("totp.issuer") }}</span>
          <input v-model.trim="formIssuer" class="input" placeholder="GitHub / Cloudflare" maxlength="80" />
        </label>
        <label>
          <span>{{ t("totp.account") }}</span>
          <input v-model.trim="formAccount" class="input" placeholder="user@example.com" required maxlength="120" />
        </label>
        <label>
          <span>{{ t("totp.secret") }}</span>
          <input v-model.trim="formSecret" class="input mono" placeholder="JBSWY3DPEHPK3PXP" required />
        </label>
        <div class="three-cols">
          <label>
            <span>{{ t("totp.algorithm") }}</span>
            <select v-model="formAlgorithm" class="select">
              <option value="SHA1">SHA1</option>
              <option value="SHA256">SHA256</option>
              <option value="SHA512">SHA512</option>
            </select>
          </label>
          <label>
            <span>{{ t("totp.digits") }}</span>
            <select v-model.number="formDigits" class="select">
              <option :value="6">6</option>
              <option :value="8">8</option>
            </select>
          </label>
          <label>
            <span>{{ t("totp.period") }}</span>
            <input v-model.number="formPeriod" class="input" type="number" min="15" max="120" />
          </label>
        </div>
        <label>
          <span>{{ t("ws.categories") }}</span>
          <select v-model="formCategoryId" class="select">
            <option :value="null">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <form v-else id="m-totp-form" class="totp-form" @submit.prevent="submitAdd">
        <label>
          <span>{{ t("totp.uriLabel") }}</span>
          <textarea
            v-model="formUriBatch"
            class="textarea mono"
            rows="5"
            placeholder="otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
            required
          />
        </label>
        <label>
          <span>{{ t("ws.categories") }}</span>
          <select v-model="formCategoryId" class="select">
            <option :value="null">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="addDialogOpen = false">{{ t("common.cancel") }}</button>
          <button class="button" type="submit" form="m-totp-form" :disabled="saving">
            <Loader2 v-if="saving" class="spin" :size="15" />
            {{ t("common.save") }}
          </button>
        </div>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.m-totp-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.m-totp-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}

.totp-controls {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.totp-filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cat-picker-box {
  flex: 1;
  min-width: 0;
}

.totp-view-seg {
  width: 132px;
  flex-shrink: 0;
}

.empty-actions {
  display: flex;
  gap: 8px;
}

.totp-card-list {
  display: grid;
  gap: 10px;
}

.totp-card {
  padding: 14px 14px 0;
  overflow: hidden;
  display: grid;
  gap: 12px;
  cursor: pointer;
  transition: transform 120ms var(--ease-out), border-color 140ms var(--ease-out);
}

.totp-card:active {
  transform: scale(0.985);
}

.totp-card.copied {
  border-color: var(--accent);
}

.card-top {
  display: flex;
  align-items: center;
  gap: 11px;
}

.issuer-badge {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-contrast);
  font-size: 16px;
  font-weight: 700;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.card-meta {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.card-title-row strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cat-chip {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--muted);
  flex-shrink: 0;
}

.account-sub {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-actions {
  display: flex;
  align-items: center;
}

.danger-ico:active {
  color: var(--danger);
}

.card-code-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.otp-big-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 32px;
  font-weight: 750;
  letter-spacing: 0.08em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.totp-card.urgent .otp-big-code {
  color: var(--danger);
}

.otp-right {
  display: flex;
  align-items: center;
}

.countdown-pill,
.copied-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.countdown-pill.urgent {
  color: var(--danger);
  border-color: var(--danger);
}

.copied-tag {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.card-progress {
  margin: 0 -14px;
  height: 3px;
  background: var(--panel-2);
}

.card-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 450ms linear;
}

.card-progress-fill.urgent {
  background: var(--danger);
}

.dialog-seg {
  margin-bottom: 12px;
}

.totp-form {
  display: grid;
  gap: 10px;
}

.totp-form label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.qr-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.small-btn {
  min-height: 36px;
  font-size: 13px;
}

.three-cols {
  display: grid;
  grid-template-columns: 1fr 0.7fr 0.8fr;
  gap: 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
