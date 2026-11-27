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
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2
} from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue"
import { useRouter } from "vue-router"
import { ApiError, api } from "@/api/client"
import CategoryPicker from "@/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { decodeQrImageFile } from "@/utils/qrDecode"

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()
const router = useRouter()

const totpView = ref<"archived" | "trash">("archived")
const selectedCategory = ref<string>("all")
const searchQuery = ref("")

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const entries = ref<TotpEntry[]>([])
const loading = ref(false)
const copiedId = ref("")

const liveCodes = ref<Record<string, { code: string; remainingSec: number; period: number }>>({})
let tickTimer: number | undefined

const addOpen = ref(false)
const addMode = ref<"manual" | "qr" | "uri">("qr")
const saving = ref(false)
const decodingQr = ref(false)
const qrInput = ref<HTMLInputElement | null>(null)
const formIssuer = ref("")
const formAccount = ref("")
const formSecret = ref("")
const formAlgorithm = ref<TotpAlgorithm>("SHA1")
const formDigits = ref<6 | 8>(6)
const formPeriod = ref(30)
const formCategoryId = ref<string>("")
const formUris = ref("")

const editOpen = ref(false)
const editingEntry = ref<TotpEntry | null>(null)
const editIssuer = ref("")
const editAccount = ref("")
const editCategoryId = ref<string>("")

const categoryNameMap = computed(() => new Map(categories.value.map((c) => [c.id, c.name])))

async function handleApiError(err: unknown) {
  if (err instanceof ApiError && err.status === 403 && !err.code) {
    await auth.loadSession()
    if (!auth.hasWorkspaceAccess) {
      await router.push("/pending")
      return
    }
  }
  ElMessage.error(err instanceof Error ? err.message : "Error")
}

async function loadCategories() {
  try {
    const res = await api.listCategories("totp")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    await handleApiError(err)
  }
}

async function loadEntries() {
  loading.value = true
  try {
    const res = await api.listTotp({
      view: totpView.value,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {})
    })
    entries.value = res.items
    await refreshCodes()
  } catch (err) {
    await handleApiError(err)
  } finally {
    loading.value = false
  }
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

function formatCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}

function ringOffset(entry: TotpEntry): number {
  const state = liveCodes.value[entry.id]
  const radius = 11
  const circumference = 2 * Math.PI * radius
  if (!state) return 0
  const ratio = Math.max(0, Math.min(1, state.remainingSec / state.period))
  return circumference * (1 - ratio)
}

async function copyCode(entry: TotpEntry) {
  const code = liveCodes.value[entry.id]?.code
  if (!code || code.includes("-")) return
  await navigator.clipboard.writeText(code)
  copiedId.value = entry.id
  window.setTimeout(() => {
    if (copiedId.value === entry.id) copiedId.value = ""
  }, 1400)
}

function openAddDialog(mode: "manual" | "qr" | "uri" = "qr") {
  addMode.value = mode
  formIssuer.value = ""
  formAccount.value = ""
  formSecret.value = ""
  formAlgorithm.value = "SHA1"
  formDigits.value = 6
  formPeriod.value = 30
  formUris.value = ""
  formCategoryId.value =
    selectedCategory.value !== "all" && selectedCategory.value !== "default" ? selectedCategory.value : ""
  addOpen.value = true
}

async function handleQrFile(file: File | undefined) {
  if (!file) return
  decodingQr.value = true
  try {
    const decoded = await decodeQrImageFile(file)
    if (!decoded.parsed) {
      ElMessage.error(t("totp.qrInvalid"))
      return
    }
    formIssuer.value = decoded.parsed.issuer
    formAccount.value = decoded.parsed.accountName
    formSecret.value = decoded.parsed.secret
    formAlgorithm.value = decoded.parsed.algorithm
    formDigits.value = decoded.parsed.digits
    formPeriod.value = decoded.parsed.period
    addMode.value = "manual"
    ElMessage.success(t("totp.qrParsed"))
  } catch {
    ElMessage.error(t("totp.qrNotFound"))
  } finally {
    decodingQr.value = false
    if (qrInput.value) qrInput.value.value = ""
  }
}

function onQrInputChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  void handleQrFile(file)
}

function onQrDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  void handleQrFile(file)
}

function onDialogPaste(event: ClipboardEvent) {
  if (!addOpen.value) return
  const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"))
  const file = item?.getAsFile()
  if (file) {
    event.preventDefault()
    void handleQrFile(file)
  }
}

async function submitAdd() {
  saving.value = true
  try {
    const categoryId = formCategoryId.value || null
    if (addMode.value === "uri") {
      const lines = formUris.value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (!lines.length) return
      const res = await api.importTotp({ uris: lines, categoryId })
      ElMessage.success(t("totp.importedCount", { count: res.imported.length }))
    } else {
      const maybeUri = parseOtpAuthUri(formSecret.value)
      if (maybeUri) {
        await api.createTotp({
          issuer: formIssuer.value.trim() || maybeUri.issuer,
          accountName: formAccount.value.trim() || maybeUri.accountName,
          secret: maybeUri.secret,
          algorithm: maybeUri.algorithm,
          digits: maybeUri.digits,
          period: maybeUri.period,
          categoryId
        })
      } else {
        await api.createTotp({
          issuer: formIssuer.value.trim(),
          accountName: formAccount.value.trim(),
          secret: formSecret.value.trim(),
          algorithm: formAlgorithm.value,
          digits: formDigits.value,
          period: formPeriod.value,
          categoryId
        })
      }
    }
    addOpen.value = false
    totpView.value = "archived"
    await Promise.all([loadEntries(), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  } finally {
    saving.value = false
  }
}

function openEdit(entry: TotpEntry) {
  editingEntry.value = entry
  editIssuer.value = entry.issuer
  editAccount.value = entry.accountName
  editCategoryId.value = entry.categoryId ?? ""
  editOpen.value = true
}

async function submitEdit() {
  if (!editingEntry.value) return
  saving.value = true
  try {
    await api.updateTotp(editingEntry.value.id, {
      issuer: editIssuer.value.trim(),
      accountName: editAccount.value.trim(),
      categoryId: editCategoryId.value || null,
      baseVersion: editingEntry.value.version
    })
    editOpen.value = false
    await Promise.all([loadEntries(), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  } finally {
    saving.value = false
  }
}

async function removeEntry(entry: TotpEntry) {
  const inTrash = entry.deletedAt !== null
  const confirmed = await confirmDialog({
    title: inTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: inTrash ? t("ws.confirmPermanentDelete") : t("totp.confirmDelete", { name: entry.issuer || entry.accountName }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  try {
    if (inTrash) {
      await api.permanentDeleteTotp(entry.id)
    } else {
      await api.deleteTotp(entry.id)
    }
    await Promise.all([loadEntries(), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

async function restoreEntry(entry: TotpEntry) {
  try {
    await api.restoreTotp(entry.id)
    await Promise.all([loadEntries(), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

async function onCategoriesChanged() {
  await Promise.all([loadCategories(), loadEntries()])
}

let searchTimer: number | undefined
watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadEntries(), 220)
})

watch(selectedCategory, () => {
  totpView.value = "archived"
  void loadEntries()
})

watch(totpView, () => {
  void loadEntries()
})

onMounted(async () => {
  await Promise.all([loadCategories(), loadEntries()])
  tickTimer = window.setInterval(() => {
    if (entries.value.length) void refreshCodes()
  }, 1000)
  window.addEventListener("paste", onDialogPaste)
})

onUnmounted(() => {
  if (tickTimer) window.clearInterval(tickTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
  window.removeEventListener("paste", onDialogPaste)
})
</script>

<template>
  <main class="totp-page">
    <section class="totp-bar">
      <div class="bar-left">
        <div class="cat-wrap">
          <CategoryPicker
            v-model="selectedCategory"
            scope="totp"
            :categories="categories"
            :default-count="defaultCount"
            @changed="onCategoriesChanged"
          />
        </div>

        <div class="view-switch">
          <button :class="{ active: totpView === 'archived' }" type="button" @click="totpView = 'archived'">
            {{ t("ws.archived") }}
          </button>
          <button :class="{ active: totpView === 'trash' }" type="button" @click="totpView = 'trash'">
            {{ t("ws.trash") }}
          </button>
        </div>

        <div class="search-box">
          <Search :size="14" class="muted" />
          <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
        </div>
      </div>

      <div class="bar-right">
        <button class="button compact-btn" type="button" @click="openAddDialog('qr')">
          <Plus :size="15" />
          {{ t("totp.add") }}
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadEntries">
          <RefreshCw :class="{ spin: loading }" :size="15" />
        </button>
      </div>
    </section>

    <section v-if="loading && !entries.length" class="empty-panel">
      <Loader2 class="spin" :size="20" />
    </section>

    <section v-else-if="!entries.length" class="empty-panel">
      <ShieldCheck :size="28" class="muted" />
      <p class="muted">{{ t("totp.empty") }}</p>
      <button v-if="totpView === 'archived'" class="button" type="button" @click="openAddDialog('qr')">
        <QrCode :size="15" />
        {{ t("totp.add") }}
      </button>
    </section>

    <section v-else class="totp-panel">
      <div class="totp-list-head">
        <span>{{ t("totp.colAccount") }}</span>
        <span>{{ t("totp.colCategory") }}</span>
        <span>{{ t("totp.colCode") }}</span>
        <span class="head-actions">{{ t("totp.colActions") }}</span>
      </div>

      <TransitionGroup tag="div" name="list-slide" class="totp-list">
        <div v-for="entry in entries" :key="entry.id" class="totp-row">
          <div class="issuer-block">
            <div class="issuer-avatar">{{ (entry.issuer || entry.accountName)[0] || "2" }}</div>
            <div class="issuer-meta">
              <div class="issuer-title-line">
                <strong>{{ entry.issuer || entry.accountName }}</strong>
                <span v-if="entry.algorithm !== 'SHA1' || entry.digits !== 6 || entry.period !== 30" class="muted spec-chip">
                  {{ entry.algorithm }} · {{ entry.digits }} · {{ entry.period }}s
                </span>
              </div>
              <span class="muted">{{ entry.accountName }}</span>
            </div>
          </div>

          <div class="row-category">
            <span class="cat-chip">
              {{ entry.categoryId ? categoryNameMap.get(entry.categoryId) || t("common.defaultCategory") : t("common.defaultCategory") }}
            </span>
          </div>

          <div class="row-code-cell">
            <button
              class="code-pill"
              type="button"
              :disabled="entry.deletedAt !== null"
              :title="t('common.copy')"
              @click="copyCode(entry)"
            >
              <span class="totp-code">{{ formatCode(liveCodes[entry.id]?.code ?? "------") }}</span>
              <span v-if="copiedId === entry.id" class="copied-tag">
                <Check :size="13" />
                {{ t("common.copied") }}
              </span>
              <Copy v-else :size="14" class="copy-hint" />
            </button>

            <div
              class="ring-wrap"
              :class="{ urgent: (liveCodes[entry.id]?.remainingSec ?? 30) <= 5 }"
              :title="`${liveCodes[entry.id]?.remainingSec ?? entry.period}s`"
            >
              <svg viewBox="0 0 28 28" class="ring-svg">
                <circle cx="14" cy="14" r="11" class="ring-track" />
                <circle
                  cx="14"
                  cy="14"
                  r="11"
                  class="ring-progress"
                  :stroke-dasharray="2 * Math.PI * 11"
                  :stroke-dashoffset="ringOffset(entry)"
                />
              </svg>
              <span class="ring-num">{{ liveCodes[entry.id]?.remainingSec ?? entry.period }}</span>
            </div>
          </div>

          <div class="row-actions">
            <button
              v-if="entry.deletedAt === null"
              class="mini-icon-btn"
              type="button"
              :title="t('ws.edit')"
              @click="openEdit(entry)"
            >
              <Pencil :size="14" />
            </button>
            <button
              v-else
              class="mini-icon-btn"
              type="button"
              :title="t('ws.restore')"
              @click="restoreEntry(entry)"
            >
              <RotateCcw :size="14" />
            </button>
            <button
              class="mini-icon-btn danger"
              type="button"
              :title="t('common.delete')"
              @click="removeEntry(entry)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </TransitionGroup>
    </section>

    <!-- Add / Import 2FA Dialog -->
    <UiDialog v-model="addOpen" width="460px" align-center>
      <template #header>
        <div class="dialog-title">
          <ShieldCheck :size="18" />
          <span>{{ t("totp.add") }}</span>
        </div>
      </template>

      <div class="add-tabs">
        <button :class="{ active: addMode === 'qr' }" type="button" @click="addMode = 'qr'">
          <QrCode :size="14" />
          {{ t("totp.modeQr") }}
        </button>
        <button :class="{ active: addMode === 'uri' }" type="button" @click="addMode = 'uri'">
          <Link2 :size="14" />
          {{ t("totp.modeUri") }}
        </button>
        <button :class="{ active: addMode === 'manual' }" type="button" @click="addMode = 'manual'">
          <KeyRound :size="14" />
          {{ t("totp.modeManual") }}
        </button>
      </div>

      <div
        v-if="addMode === 'qr'"
        class="qr-dropzone"
        @dragover.prevent
        @drop.prevent="onQrDrop"
        @click="qrInput?.click()"
      >
        <input ref="qrInput" type="file" accept="image/*" hidden @change="onQrInputChange" />
        <Loader2 v-if="decodingQr" class="spin" :size="24" />
        <ImagePlus v-else :size="24" />
        <strong>{{ t("totp.qrDropTitle") }}</strong>
        <span class="muted">{{ t("totp.qrDropHint") }}</span>
      </div>

      <form v-else-if="addMode === 'uri'" id="totp-add-form" class="dialog-form" @submit.prevent="submitAdd">
        <label>
          <span>{{ t("totp.uriLabel") }}</span>
          <textarea
            v-model="formUris"
            class="textarea mono"
            rows="4"
            placeholder="otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
            required
          />
        </label>
        <label>
          <span>{{ t("ws.category") }}</span>
          <select v-model="formCategoryId" class="select">
            <option value="">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <form v-else id="totp-add-form" class="dialog-form" @submit.prevent="submitAdd">
        <label>
          <span>{{ t("totp.issuer") }}</span>
          <input v-model.trim="formIssuer" class="input" placeholder="GitHub / Cloudflare" maxlength="80" />
        </label>
        <label>
          <span>{{ t("totp.account") }}</span>
          <input v-model.trim="formAccount" class="input" placeholder="name@example.com" maxlength="120" required />
        </label>
        <label>
          <span>{{ t("totp.secret") }}</span>
          <input v-model.trim="formSecret" class="input mono" placeholder="Base32 Secret / otpauth://" required />
        </label>
        <div class="inline-3">
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
            <input v-model.number="formPeriod" class="input" type="number" min="10" max="120" />
          </label>
        </div>
        <label>
          <span>{{ t("ws.category") }}</span>
          <select v-model="formCategoryId" class="select">
            <option value="">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="addOpen = false">{{ t("common.cancel") }}</button>
          <button
            v-if="addMode !== 'qr'"
            class="button"
            type="submit"
            form="totp-add-form"
            :disabled="saving"
          >
            {{ t("common.save") }}
          </button>
        </div>
      </template>
    </UiDialog>

    <!-- Edit 2FA Dialog -->
    <UiDialog v-model="editOpen" width="400px" align-center>
      <template #header>
        <div class="dialog-title">
          <Pencil :size="17" />
          <span>{{ t("ws.edit") }}</span>
        </div>
      </template>

      <form id="totp-edit-form" class="dialog-form" @submit.prevent="submitEdit">
        <label>
          <span>{{ t("totp.issuer") }}</span>
          <input v-model.trim="editIssuer" class="input" maxlength="80" />
        </label>
        <label>
          <span>{{ t("totp.account") }}</span>
          <input v-model.trim="editAccount" class="input" maxlength="120" required />
        </label>
        <label>
          <span>{{ t("ws.category") }}</span>
          <select v-model="editCategoryId" class="select">
            <option value="">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="editOpen = false">{{ t("common.cancel") }}</button>
          <button class="button" type="submit" form="totp-edit-form" :disabled="saving">
            {{ t("common.save") }}
          </button>
        </div>
      </template>
    </UiDialog>
  </main>
</template>

<style scoped>
.totp-page {
  width: min(1180px, calc(100% - 32px));
  margin: 0 auto;
  padding: 18px 0 36px;
  display: grid;
  gap: 16px;
}

.totp-bar {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.bar-left {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.cat-wrap {
  width: 170px;
}

.view-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
}

.view-switch button {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.view-switch button.active {
  background: var(--accent);
  color: var(--accent-contrast);
}

.search-box {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  min-width: 180px;
  flex: 1;
  max-width: 280px;
}

.search-box input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 13px;
}

.bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compact-btn {
  min-height: 32px;
  padding: 0 12px;
  font-size: 13px;
  border-radius: 6px;
}

.compact-icon {
  width: 32px;
  min-height: 32px;
  border-radius: 6px;
}

.empty-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 56px 24px;
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.empty-panel p {
  margin: 0;
  font-size: 13px;
}

.totp-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.totp-list-head,
.totp-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) minmax(96px, 0.45fr) minmax(220px, auto) 80px;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
}

.totp-list-head {
  min-height: 40px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.head-actions {
  text-align: right;
}

.totp-row {
  min-height: 64px;
  padding-top: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.totp-row:last-child {
  border-bottom: 0;
}

.totp-row:hover {
  background: var(--surface-hover);
}

.issuer-block {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.issuer-avatar {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: var(--surface-hover);
  color: var(--accent);
  font-weight: 800;
  font-size: 14px;
  text-transform: uppercase;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.totp-row:hover .issuer-avatar {
  background: var(--surface-strong);
}

.issuer-meta {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.issuer-title-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.issuer-meta strong,
.issuer-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issuer-meta strong {
  font-size: 14px;
}

.issuer-meta span {
  font-size: 12px;
}

.row-category {
  min-width: 0;
}

.row-code-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-pill {
  min-width: 158px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.code-pill:hover:not(:disabled) {
  background: var(--panel);
  border-color: var(--accent);
}

.totp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.copy-hint {
  color: var(--muted);
  flex-shrink: 0;
}

.copied-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
  flex-shrink: 0;
}

.ring-wrap {
  position: relative;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.ring-svg {
  width: 30px;
  height: 30px;
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--surface-strong);
  stroke-width: 2.5;
}

.ring-progress {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 250ms linear;
}

.ring-wrap.urgent .ring-progress {
  stroke: var(--danger);
}

.ring-num {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.ring-wrap.urgent .ring-num {
  color: var(--danger);
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.mini-icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mini-icon-btn:hover {
  border-color: var(--accent);
  color: var(--text);
}

.mini-icon-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.cat-chip {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 5px;
  background: var(--surface-hover);
  color: var(--muted);
}

.totp-row:hover .cat-chip {
  background: var(--surface-strong);
}

.spec-chip {
  font-size: 11px;
}

@media (max-width: 760px) {
  .totp-list-head {
    display: none;
  }

  .totp-row {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
  }

  .row-category {
    grid-column: 1 / -1;
    order: 3;
  }

  .row-code-cell {
    grid-column: 1 / -1;
    justify-content: space-between;
    order: 2;
  }

  .code-pill {
    flex: 1;
  }

  .row-actions {
    order: 1;
  }
}

.add-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 14px;
}

.add-tabs button {
  min-height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.add-tabs button.active {
  border-color: var(--accent);
  background: var(--surface-hover);
  color: var(--accent);
}

.qr-dropzone {
  border: 1.5px dashed var(--line-strong);
  border-radius: 8px;
  background: var(--panel-2);
  padding: 36px 20px;
  display: grid;
  justify-items: center;
  gap: 8px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out);
}

.qr-dropzone:hover {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.qr-dropzone strong {
  font-size: 14px;
}

.qr-dropzone span {
  font-size: 12px;
}

.dialog-form {
  display: grid;
  gap: 12px;
}

.dialog-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}

.inline-3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
