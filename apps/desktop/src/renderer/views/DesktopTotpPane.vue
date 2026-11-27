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
import { api } from "@/api/client"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import { t } from "@/i18n"
import { useSyncStore } from "@/stores/sync"
import { decodeQrImageFile } from "@/utils/qrDecode"

const UiDialog = ElDialog as unknown as Component
const sync = useSyncStore()

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

async function loadCategories() {
  try {
    const res = await api.listCategories("totp")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch {
    // offline fallback
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
  } catch {
    entries.value = sync.totpEntries.filter((e) =>
      totpView.value === "trash" ? e.deletedAt !== null : e.deletedAt === null
    )
  } finally {
    loading.value = false
    await refreshCodes()
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

function formatCode(code: string) {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`
  return code
}

function ringOffset(entry: TotpEntry) {
  const state = liveCodes.value[entry.id]
  const c = 2 * Math.PI * 11
  if (!state) return 0
  return c * (1 - Math.max(0, Math.min(1, state.remainingSec / state.period)))
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

async function submitAdd() {
  saving.value = true
  try {
    const categoryId = formCategoryId.value || null
    if (addMode.value === "uri") {
      const lines = formUris.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
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
    await Promise.all([loadEntries(), loadCategories(), sync.syncNow()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
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
    await Promise.all([loadEntries(), loadCategories(), sync.syncNow()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
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
  if (inTrash) await api.permanentDeleteTotp(entry.id)
  else await api.deleteTotp(entry.id)
  await Promise.all([loadEntries(), loadCategories(), sync.syncNow()])
}

async function restoreEntry(entry: TotpEntry) {
  await api.restoreTotp(entry.id)
  await Promise.all([loadEntries(), loadCategories(), sync.syncNow()])
}

function onPaste(event: ClipboardEvent) {
  if (!addOpen.value) return
  const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith("image/"))
  const file = item?.getAsFile()
  if (file) {
    event.preventDefault()
    void handleQrFile(file)
  }
}

let searchTimer: number | undefined
watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadEntries(), 200)
})
watch(selectedCategory, () => {
  totpView.value = "archived"
  void loadEntries()
})
watch(totpView, () => void loadEntries())

onMounted(async () => {
  await Promise.all([loadCategories(), loadEntries()])
  tickTimer = window.setInterval(() => {
    if (entries.value.length) void refreshCodes()
  }, 1000)
  window.addEventListener("paste", onPaste)
})

onUnmounted(() => {
  if (tickTimer) window.clearInterval(tickTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
  window.removeEventListener("paste", onPaste)
})

defineExpose({ createNew: () => openAddDialog("qr"), refresh: loadEntries })
</script>

<template>
  <div class="desktop-scroll-page">
    <div class="totp-wrap">
      <section class="totp-bar">
        <div class="bar-left">
          <div class="cat-wrap">
            <CategoryPicker
              v-model="selectedCategory"
              scope="totp"
              :categories="categories"
              :default-count="defaultCount"
              @changed="loadCategories(); loadEntries()"
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
            <Search :size="13" class="muted" />
            <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
          </div>
        </div>

        <div class="bar-right">
          <button class="button compact-btn" type="button" @click="openAddDialog('qr')">
            <Plus :size="14" />
            {{ t("totp.add") }}
          </button>
          <button class="icon-button compact-icon" type="button" @click="loadEntries">
            <RefreshCw :class="{ spin: loading }" :size="14" />
          </button>
        </div>
      </section>

      <section v-if="loading && !entries.length" class="empty-panel"><Loader2 class="spin" :size="20" /></section>
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

        <div v-for="entry in entries" :key="entry.id" class="totp-row">
          <div class="issuer-block">
            <div class="issuer-avatar">{{ (entry.issuer || entry.accountName)[0] || "2" }}</div>
            <div class="issuer-meta">
              <strong>{{ entry.issuer || entry.accountName }}</strong>
              <span class="muted">{{ entry.accountName }}</span>
            </div>
          </div>

          <div>
            <span class="cat-chip">
              {{ entry.categoryId ? categoryNameMap.get(entry.categoryId) || t("common.defaultCategory") : t("common.defaultCategory") }}
            </span>
          </div>

          <div class="row-code-cell">
            <button
              class="code-pill"
              type="button"
              :disabled="entry.deletedAt !== null"
              @click="copyCode(entry)"
            >
              <span class="totp-code">{{ formatCode(liveCodes[entry.id]?.code ?? "------") }}</span>
              <span v-if="copiedId === entry.id" class="copied-tag"><Check :size="13" />{{ t("common.copied") }}</span>
              <Copy v-else :size="14" class="muted" />
            </button>
            <div class="ring-wrap" :class="{ urgent: (liveCodes[entry.id]?.remainingSec ?? 30) <= 5 }">
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
            <button v-if="entry.deletedAt === null" class="mini-icon-btn" type="button" @click="openEdit(entry)">
              <Pencil :size="13" />
            </button>
            <button v-else class="mini-icon-btn" type="button" @click="restoreEntry(entry)">
              <RotateCcw :size="13" />
            </button>
            <button class="mini-icon-btn danger" type="button" @click="removeEntry(entry)">
              <Trash2 :size="13" />
            </button>
          </div>
        </div>
      </section>
    </div>

    <UiDialog v-model="addOpen" width="460px" align-center>
      <template #header>
        <div class="dialog-title"><ShieldCheck :size="18" /><span>{{ t("totp.add") }}</span></div>
      </template>
      <div class="add-tabs">
        <button :class="{ active: addMode === 'qr' }" type="button" @click="addMode = 'qr'">
          <QrCode :size="14" />{{ t("totp.modeQr") }}
        </button>
        <button :class="{ active: addMode === 'uri' }" type="button" @click="addMode = 'uri'">
          <Link2 :size="14" />{{ t("totp.modeUri") }}
        </button>
        <button :class="{ active: addMode === 'manual' }" type="button" @click="addMode = 'manual'">
          <KeyRound :size="14" />{{ t("totp.modeManual") }}
        </button>
      </div>

      <div
        v-if="addMode === 'qr'"
        class="qr-dropzone"
        @dragover.prevent
        @drop.prevent="(e) => handleQrFile(e.dataTransfer?.files?.[0])"
        @click="qrInput?.click()"
      >
        <input ref="qrInput" type="file" accept="image/*" hidden @change="(e) => handleQrFile((e.target as HTMLInputElement).files?.[0])" />
        <Loader2 v-if="decodingQr" class="spin" :size="24" />
        <ImagePlus v-else :size="24" />
        <strong>{{ t("totp.qrDropTitle") }}</strong>
        <span class="muted">{{ t("totp.qrDropHint") }}</span>
      </div>

      <form v-else-if="addMode === 'uri'" id="desk-totp-add" class="dialog-form" @submit.prevent="submitAdd">
        <label>
          <span>{{ t("totp.uriLabel") }}</span>
          <textarea v-model="formUris" class="textarea mono" rows="4" required />
        </label>
        <label>
          <span>{{ t("ws.category") }}</span>
          <select v-model="formCategoryId" class="select">
            <option value="">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </label>
      </form>

      <form v-else id="desk-totp-add" class="dialog-form" @submit.prevent="submitAdd">
        <label><span>{{ t("totp.issuer") }}</span><input v-model.trim="formIssuer" class="input" maxlength="80" /></label>
        <label><span>{{ t("totp.account") }}</span><input v-model.trim="formAccount" class="input" maxlength="120" required /></label>
        <label><span>{{ t("totp.secret") }}</span><input v-model.trim="formSecret" class="input mono" required /></label>
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
          <label><span>{{ t("totp.period") }}</span><input v-model.number="formPeriod" class="input" type="number" min="10" max="120" /></label>
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
          <button v-if="addMode !== 'qr'" class="button" type="submit" form="desk-totp-add" :disabled="saving">{{ t("common.save") }}</button>
        </div>
      </template>
    </UiDialog>

    <UiDialog v-model="editOpen" width="380px" align-center>
      <template #header>
        <div class="dialog-title"><Pencil :size="16" /><span>{{ t("ws.edit") }}</span></div>
      </template>
      <form id="desk-totp-edit" class="dialog-form" @submit.prevent="submitEdit">
        <label><span>{{ t("totp.issuer") }}</span><input v-model.trim="editIssuer" class="input" maxlength="80" /></label>
        <label><span>{{ t("totp.account") }}</span><input v-model.trim="editAccount" class="input" maxlength="120" required /></label>
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
          <button class="button" type="submit" form="desk-totp-edit" :disabled="saving">{{ t("common.save") }}</button>
        </div>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.totp-wrap {
  display: grid;
  gap: 14px;
}

.totp-bar {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.bar-left,
.bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cat-wrap {
  width: 165px;
}

.view-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
}

.view-switch button {
  height: 26px;
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
  gap: 6px;
  height: 30px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel-2);
  width: 220px;
}

.search-box input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12px;
}

.compact-btn {
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
  border-radius: 6px;
}

.compact-icon {
  width: 30px;
  min-height: 30px;
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
  grid-template-columns: minmax(200px, 1.4fr) minmax(90px, 0.45fr) minmax(210px, auto) 80px;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
}

.totp-list-head {
  min-height: 38px;
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
  min-height: 60px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
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
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--surface-hover);
  color: var(--accent);
  font-weight: 800;
  font-size: 13px;
  text-transform: uppercase;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.issuer-meta {
  display: grid;
  min-width: 0;
}

.issuer-meta strong,
.issuer-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issuer-meta strong {
  font-size: 13px;
}

.issuer-meta span {
  font-size: 12px;
}

.cat-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 5px;
  background: var(--surface-hover);
  color: var(--muted);
}

.row-code-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.code-pill {
  min-width: 152px;
  height: 34px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.code-pill:hover:not(:disabled) {
  background: var(--panel);
  border-color: var(--accent);
}

.totp-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}

.copied-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 650;
  color: var(--accent);
}

.ring-wrap {
  position: relative;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
}

.ring-svg {
  width: 28px;
  height: 28px;
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
}

.ring-wrap.urgent .ring-progress {
  stroke: var(--danger);
}

.ring-num {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
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
  width: 26px;
  height: 26px;
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

.add-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 14px;
}

.add-tabs button {
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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
  padding: 32px 18px;
  display: grid;
  justify-items: center;
  gap: 8px;
  cursor: pointer;
}

.dialog-form {
  display: grid;
  gap: 11px;
}

.dialog-form label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.inline-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
</style>
