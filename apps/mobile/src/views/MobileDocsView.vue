<script setup lang="ts">
import type {
  Category,
  DocumentDetail,
  DocumentSummary,
  DocumentType,
  SheetWorkbook
} from "@notepad/core"
import {
  ArrowLeft,
  Download,
  FileText,
  Link2,
  Loader2,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Table2,
  Trash2,
  Upload
} from "@lucide/vue"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import DocEditor from "@web/components/DocEditor.vue"
import ShareDialog from "@web/components/ShareDialog.vue"
import SheetEditor from "@web/components/SheetEditor.vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { currentLocale as locale, formatDateTime, t } from "@/i18n"
import { hapticImpact } from "@/native/bridge"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"
import {
  downloadBlob,
  exportTiptapToDocx,
  exportWorkbookToFile,
  extractDocExcerpt,
  importDocxToHtml,
  importSpreadsheetFile
} from "@/utils/docConverters"
import { extractSheetExcerpt } from "@/utils/sheetFormula"

function defaultWordContent(): Record<string, unknown> {
  return { type: "doc", content: [{ type: "paragraph" }] }
}

function defaultSheetWorkbook(): SheetWorkbook {
  return {
    activeSheetId: "sheet_1",
    sheets: [{ id: "sheet_1", name: "Sheet1", rows: 30, cols: 12, colWidths: {}, cells: {} }]
  }
}

const emit = defineEmits<{
  "detail-change": [open: boolean]
}>()

const auth = useAuthStore()
const sync = useSyncStore()

const selectedCategory = ref("all")
const docCategories = ref<Category[]>([])
const sheetCategories = ref<Category[]>([])
const defaultCount = ref(0)
const docView = ref<"archived" | "trash">("archived")
const searchQuery = ref("")
const showSearch = ref(false)
const createSheetOpen = ref(false)

const documents = ref<DocumentSummary[]>([])
const loadingDocs = ref(false)
const activeDoc = ref<DocumentDetail | null>(null)
const loadingDetail = ref(false)
const docTitle = ref("")
const docCategoryId = ref<string | null>(null)
const wordContent = ref<Record<string, unknown>>(defaultWordContent())
const sheetContent = ref<SheetWorkbook>(defaultSheetWorkbook())
const savingState = ref<"idle" | "saving" | "saved" | "error">("idle")
const shareOpen = ref(false)
const importInput = ref<HTMLInputElement | null>(null)

let saveTimer: number | null = null
let searchTimer: number | null = null

const canShare = computed(() => auth.can("share:manage"))
const allCategories = computed(() => [...docCategories.value, ...sheetCategories.value])
const activeCategories = computed(() =>
  activeDoc.value?.docType === "sheet" ? sheetCategories.value : docCategories.value
)

watch(
  () => Boolean(activeDoc.value),
  (open) => emit("detail-change", open),
  { immediate: true }
)

function closeDetail() {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
    void flushSave()
  }
  activeDoc.value = null
}

function categoryNameFor(item: DocumentSummary): string {
  if (!item.categoryId) return ""
  const pool = item.docType === "sheet" ? sheetCategories.value : docCategories.value
  return pool.find((c) => c.id === item.categoryId)?.name ?? ""
}

async function loadCategories() {
  try {
    const [dRes, sRes] = await Promise.all([
      api.listCategories("document"),
      api.listCategories("sheet")
    ])
    docCategories.value = dRes.categories
    sheetCategories.value = sRes.categories
    defaultCount.value = dRes.defaultCount + sRes.defaultCount
  } catch {
    docCategories.value = sync.categories
      .filter((c) => c.scope === "document" && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
    sheetCategories.value = sync.categories
      .filter((c) => c.scope === "sheet" && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
    defaultCount.value = sync.documents.filter((d) => d.deletedAt === null && d.categoryId === null).length
  }
}

async function loadDocuments() {
  loadingDocs.value = true
  try {
    const res = await api.listDocuments({
      view: docView.value,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value ? { q: searchQuery.value } : {})
    })
    documents.value = res.items
  } catch {
    const q = searchQuery.value.toLowerCase()
    documents.value = sync.documents
      .filter((d) => {
        if (selectedCategory.value === "all") return true
        if (selectedCategory.value === "default" || selectedCategory.value === "uncategorized") {
          return d.categoryId === null
        }
        return d.categoryId === selectedCategory.value
      })
      .filter((d) => (docView.value === "trash" ? d.deletedAt !== null : d.deletedAt === null))
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt)
  } finally {
    loadingDocs.value = false
  }
}

async function openDocument(id: string) {
  loadingDetail.value = true
  void hapticImpact("light")
  try {
    const res = await api.getDocument(id)
    activeDoc.value = res.document
    docTitle.value = res.document.title
    docCategoryId.value = res.document.categoryId
    if (res.document.docType === "sheet") {
      sheetContent.value = (res.document.content as unknown as SheetWorkbook) ?? defaultSheetWorkbook()
    } else {
      wordContent.value = (res.document.content as Record<string, unknown>) ?? defaultWordContent()
    }
    savingState.value = "idle"
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed to load document")
  } finally {
    loadingDetail.value = false
  }
}

async function createDoc(targetType: DocumentType) {
  createSheetOpen.value = false
  void hapticImpact("medium")
  try {
    const matchingPool = targetType === "sheet" ? sheetCategories.value : docCategories.value
    const catId = matchingPool.some((c) => c.id === selectedCategory.value)
      ? selectedCategory.value
      : null
    const res = await api.createDocument({
      docType: targetType,
      title: "",
      categoryId: catId
    })
    activeDoc.value = res.document
    docTitle.value = res.document.title
    docCategoryId.value = res.document.categoryId
    if (res.document.docType === "sheet") {
      sheetContent.value = (res.document.content as unknown as SheetWorkbook) ?? defaultSheetWorkbook()
    } else {
      wordContent.value = (res.document.content as Record<string, unknown>) ?? defaultWordContent()
    }
    savingState.value = "idle"
    await Promise.all([loadCategories(), loadDocuments(), sync.pull()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed to create document")
  }
}

function triggerImport() {
  createSheetOpen.value = false
  importInput.value?.click()
}

function scheduleSave() {
  if (!activeDoc.value || activeDoc.value.deletedAt !== null) return
  savingState.value = "saving"
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flushSave(), 700)
}

async function flushSave() {
  if (!activeDoc.value || activeDoc.value.deletedAt !== null) return
  try {
    const isSheet = activeDoc.value.docType === "sheet"
    const content: Record<string, unknown> = isSheet
      ? (sheetContent.value as unknown as Record<string, unknown>)
      : wordContent.value
    const excerpt = isSheet ? extractSheetExcerpt(sheetContent.value) : extractDocExcerpt(wordContent.value)
    const res = await api.updateDocument(activeDoc.value.id, {
      title: docTitle.value,
      categoryId: docCategoryId.value,
      content,
      excerpt,
      baseVersion: activeDoc.value.version
    })
    activeDoc.value = res.document
    savingState.value = "saved"
    const idx = documents.value.findIndex((d) => d.id === res.document.id)
    if (idx !== -1) documents.value[idx] = res.document
    else await loadDocuments()
    void sync.pull()
  } catch (err) {
    savingState.value = "error"
    ElMessage.error(err instanceof Error ? err.message : t("ws.conflict"))
  }
}

async function onImportPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  try {
    const lower = file.name.toLowerCase()
    const targetType: DocumentType =
      lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv") ? "sheet" : "doc"
    const baseTitle = file.name.replace(/\.[^.]+$/, "")
    let content: Record<string, unknown>
    if (targetType === "sheet") {
      content = (await importSpreadsheetFile(file)) as unknown as Record<string, unknown>
    } else {
      const html = await importDocxToHtml(file)
      const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      content = {
        type: "doc",
        content: [{ type: "paragraph", content: plain ? [{ type: "text", text: plain }] : [] }]
      }
    }
    const res = await api.createDocument({
      docType: targetType,
      title: baseTitle,
      categoryId: null,
      content
    })
    ElMessage.success(t("docs.imported"))
    await Promise.all([loadCategories(), loadDocuments(), sync.pull()])
    await openDocument(res.document.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Import failed")
  }
}

async function exportActive() {
  if (!activeDoc.value) return
  const title = docTitle.value || t("ws.noteTitle")
  if (activeDoc.value.docType === "sheet") {
    const blob = await exportWorkbookToFile(sheetContent.value, "xlsx")
    downloadBlob(blob, `${title}.xlsx`)
  } else {
    const blob = await exportTiptapToDocx(title, wordContent.value)
    downloadBlob(blob, `${title}.docx`)
  }
}

async function togglePin() {
  if (!activeDoc.value) return
  const res = await api.updateDocument(activeDoc.value.id, { isPinned: !activeDoc.value.isPinned })
  activeDoc.value = res.document
  await loadDocuments()
}

async function deleteActive() {
  if (!activeDoc.value) return
  const isTrash = activeDoc.value.deletedAt !== null
  const confirmed = await confirmDialog({
    title: isTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: isTrash ? t("ws.confirmPermanentDelete") : t("ws.confirmDeleteNote"),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  if (isTrash) await api.permanentDeleteDocument(activeDoc.value.id)
  else await api.deleteDocument(activeDoc.value.id)
  activeDoc.value = null
  await Promise.all([loadCategories(), loadDocuments(), sync.pull()])
}

async function restoreActive() {
  if (!activeDoc.value) return
  await api.restoreDocument(activeDoc.value.id)
  activeDoc.value = null
  await Promise.all([loadCategories(), loadDocuments(), sync.pull()])
}

watch([selectedCategory, docView], () => {
  void loadDocuments()
})

watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadDocuments(), 240)
})

onMounted(() => {
  void Promise.all([loadCategories(), loadDocuments()])
})

onBeforeUnmount(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
})

defineExpose({
  closeDetail,
  hasOpenDetail: () => Boolean(activeDoc.value)
})
</script>

<template>
  <div class="m-docs-shell">
    <!-- MASTER LIST (Unified Word Docs + Excel Sheets, no top segmented switcher) -->
    <template v-if="!activeDoc">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <FileText :size="19" />
            <h1 class="mobile-topbar-title">{{ t("nav.docs") }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <button class="m-icon-btn" type="button" @click="showSearch = !showSearch">
              <Search :size="18" />
            </button>
            <button class="m-icon-btn" type="button" @click="loadDocuments">
              <RefreshCw :class="{ spin: loadingDocs }" :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div class="mobile-stage">
        <div class="mobile-scroll with-fab">
          <div class="list-controls">
            <div class="filter-row">
              <div class="cat-wrap">
                <CategoryPicker
                  v-model="selectedCategory"
                  scope="document"
                  :categories="allCategories"
                  :default-count="defaultCount"
                  @changed="loadCategories(); loadDocuments()"
                />
              </div>

              <div class="m-segmented view-seg">
                <button :class="{ active: docView === 'archived' }" type="button" @click="docView = 'archived'">
                  {{ t("ws.archived") }}
                </button>
                <button :class="{ active: docView === 'trash' }" type="button" @click="docView = 'trash'">
                  {{ t("ws.trash") }}
                </button>
              </div>
            </div>

            <div v-if="showSearch" class="m-search-row">
              <Search :size="15" class="muted" />
              <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
            </div>
          </div>

          <div v-if="loadingDocs && !documents.length" class="m-empty">
            <Loader2 class="spin" :size="22" />
          </div>

          <div v-else-if="!documents.length" class="m-empty">
            <FileText :size="34" />
            <p>{{ t("docs.empty") }}</p>
          </div>

          <div v-else class="doc-card-list">
            <article
              v-for="item in documents"
              :key="item.id"
              class="m-card doc-card"
              @click="openDocument(item.id)"
            >
              <!-- Distinct visual badges: Dark solid Grid for Excel vs Light framed W for Word -->
              <div class="doc-badge" :class="item.docType === 'sheet' ? 'is-sheet' : 'is-doc'">
                <Table2 v-if="item.docType === 'sheet'" :size="18" />
                <span v-else class="word-glyph">W</span>
              </div>

              <div class="doc-card-main">
                <div class="doc-card-head">
                  <strong>{{ item.title || t("ws.noteTitle") }}</strong>
                  <Pin v-if="item.isPinned" :size="13" />
                </div>
                <p v-if="item.excerpt" class="doc-excerpt">{{ item.excerpt }}</p>
                <div class="doc-foot-row">
                  <span class="type-pill" :class="item.docType === 'sheet' ? 'is-sheet' : 'is-doc'">
                    {{ item.docType === "sheet" ? "Excel" : "Word" }}
                  </span>
                  <span v-if="categoryNameFor(item)" class="cat-dot">{{ categoryNameFor(item) }}</span>
                  <span class="doc-time">{{ formatDateTime(item.updatedAt) }}</span>
                </div>
              </div>
            </article>
          </div>
        </div>

        <input ref="importInput" type="file" accept=".docx,.xlsx,.xls,.csv" hidden @change="onImportPicked" />
        <button
          v-if="docView !== 'trash'"
          class="mobile-fab icon-only"
          type="button"
          :title="t('common.create')"
          @click="createSheetOpen = true"
        >
          <Plus :size="24" />
        </button>
      </div>

      <!-- Create Type Picker Action Sheet -->
      <Teleport to="body">
        <Transition name="sheet-fade">
          <div v-if="createSheetOpen" class="action-sheet-backdrop" @click="createSheetOpen = false">
            <div class="action-sheet" @click.stop>
              <div class="sheet-handle" />
              <div class="sheet-title">
                {{ locale === "zh-CN" ? "选择新建类型" : "Create New" }}
              </div>

              <button class="sheet-option" type="button" @click="createDoc('doc')">
                <span class="doc-badge is-doc"><span class="word-glyph">W</span></span>
                <span class="sheet-opt-text">
                  <strong>{{ t("docs.newWord") }}</strong>
                  <span class="muted">{{ locale === "zh-CN" ? "Word 富文本排版文档" : "Rich text Word document" }}</span>
                </span>
              </button>

              <button class="sheet-option" type="button" @click="createDoc('sheet')">
                <span class="doc-badge is-sheet"><Table2 :size="18" /></span>
                <span class="sheet-opt-text">
                  <strong>{{ t("docs.newSheet") }}</strong>
                  <span class="muted">{{ locale === "zh-CN" ? "Excel 多工作表与公式" : "Multi-sheet Excel workbook" }}</span>
                </span>
              </button>

              <button class="sheet-option" type="button" @click="triggerImport">
                <span class="doc-badge is-import"><Upload :size="17" /></span>
                <span class="sheet-opt-text">
                  <strong>{{ locale === "zh-CN" ? "导入本地文件" : "Import File" }}</strong>
                  <span class="muted">.docx / .xlsx / .csv</span>
                </span>
              </button>

              <button class="sheet-cancel" type="button" @click="createSheetOpen = false">
                {{ t("common.cancel") }}
              </button>
            </div>
          </div>
        </Transition>
      </Teleport>
    </template>

    <!-- DETAIL EDITOR -->
    <template v-else>
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeDetail">
              <ArrowLeft :size="20" />
            </button>
            <span class="save-badge">
              {{
                savingState === "saving"
                  ? t("common.saving")
                  : savingState === "saved"
                    ? t("common.saved")
                    : savingState === "error"
                      ? t("ws.conflict")
                      : activeDoc.docType === "sheet"
                        ? t("nav.sheets")
                        : t("nav.docs")
              }}
            </span>
          </div>
          <div class="mobile-topbar-actions">
            <button
              class="m-icon-btn"
              type="button"
              :title="activeDoc.docType === 'sheet' ? t('docs.exportExcel') : t('docs.exportWord')"
              @click="exportActive"
            >
              <Download :size="17" />
            </button>
            <button
              v-if="activeDoc.deletedAt === null"
              class="m-icon-btn"
              :class="{ bordered: activeDoc.isPinned }"
              type="button"
              @click="togglePin"
            >
              <Pin :size="17" />
            </button>
            <button
              v-if="canShare && activeDoc.deletedAt === null"
              class="m-icon-btn"
              type="button"
              @click="shareOpen = true"
            >
              <Link2 :size="17" />
            </button>
            <button v-if="activeDoc.deletedAt !== null" class="m-icon-btn" type="button" @click="restoreActive">
              <RotateCcw :size="17" />
            </button>
            <button class="m-icon-btn danger-ico" type="button" @click="deleteActive">
              <Trash2 :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div v-if="loadingDetail" class="m-empty">
        <Loader2 class="spin" :size="22" />
      </div>

      <div v-else class="detail-body mobile-doc-wrap">
        <div class="detail-meta">
          <input
            v-model="docTitle"
            class="detail-title-input"
            :placeholder="t('ws.noteTitle')"
            :disabled="activeDoc.deletedAt !== null"
            @input="scheduleSave"
          />
          <select
            v-model="docCategoryId"
            class="cat-mini-select"
            :disabled="activeDoc.deletedAt !== null"
            @change="scheduleSave"
          >
            <option :value="null">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in activeCategories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </div>

        <div class="editor-stage">
          <DocEditor
            v-if="activeDoc.docType === 'doc'"
            v-model="wordContent"
            :title="docTitle || 'document'"
            :readonly="activeDoc.deletedAt !== null"
            @update:model-value="scheduleSave"
          />
          <SheetEditor
            v-else
            v-model="sheetContent"
            :title="docTitle || 'spreadsheet'"
            :readonly="activeDoc.deletedAt !== null"
            @update:model-value="scheduleSave"
          />
        </div>
      </div>

      <ShareDialog
        v-model="shareOpen"
        target-type="document"
        :target-id="activeDoc.id"
        :target-title="activeDoc.title || t('ws.noteTitle')"
        :site-config="auth.siteConfig"
      />
    </template>
  </div>
</template>

<style scoped>
.m-docs-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.list-controls {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cat-wrap {
  flex: 1;
  min-width: 0;
}

.view-seg {
  width: 132px;
  flex-shrink: 0;
}

.doc-card-list {
  display: grid;
  gap: 9px;
}

.doc-card {
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: transform 120ms var(--ease-out);
}

.doc-card:active {
  transform: scale(0.985);
}

.doc-badge {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.doc-badge.is-doc {
  background: #2563eb;
  border: 1px solid #1d4ed8;
  color: #ffffff;
}

.doc-badge.is-sheet {
  background: #16a34a;
  border: 1px solid #15803d;
  color: #ffffff;
}

:global([data-theme="dark"]) .doc-badge.is-sheet {
  background: #38bdf8;
  border-color: #0ea5e9;
  color: #082f49;
}

.doc-badge.is-import {
  background: var(--panel-2);
  border: 1px dashed var(--muted);
  color: var(--muted);
}

.word-glyph {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
}

.doc-card-main {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 4px;
}

.doc-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.doc-card-head strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-excerpt {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-foot-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.type-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.02em;
}

.type-pill.is-doc {
  background: rgba(37, 99, 235, 0.12);
  border: 1px solid rgba(37, 99, 235, 0.25);
  color: #1d4ed8;
}

.type-pill.is-sheet {
  background: rgba(22, 163, 74, 0.12);
  border: 1px solid rgba(22, 163, 74, 0.25);
  color: #15803d;
}

:global([data-theme="dark"]) .type-pill.is-doc {
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.3);
  color: #93c5fd;
}

:global([data-theme="dark"]) .type-pill.is-sheet {
  background: rgba(56, 189, 248, 0.18);
  border-color: rgba(125, 211, 252, 0.34);
  color: #7dd3fc;
}

.cat-dot {
  font-size: 11px;
  color: var(--muted);
}

.doc-time {
  font-size: 11px;
  color: var(--muted);
}

.save-badge {
  font-size: 13px;
  color: var(--muted);
  font-weight: 550;
}

.danger-ico:active {
  color: var(--danger);
}

.detail-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}

.detail-meta {
  padding: 10px 14px 8px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  gap: 8px;
}

.detail-title-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 17px;
  font-weight: 700;
}

.cat-mini-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  flex-shrink: 0;
}

.editor-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>

<style>
.action-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3300;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.action-sheet {
  width: 100%;
  max-width: 480px;
  background: var(--panel);
  border-top: 1px solid var(--line);
  border-radius: 18px 18px 0 0;
  padding: 10px 16px calc(18px + var(--safe-bottom));
  display: grid;
  gap: 8px;
  box-shadow: 0 -10px 32px rgba(0, 0, 0, 0.2);
}

.sheet-handle {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--line);
  margin: 0 auto 4px;
}

.sheet-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--muted);
  padding: 0 4px 4px;
}

.sheet-option {
  width: 100%;
  padding: 11px 12px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  cursor: pointer;
}

.sheet-option:active {
  background: var(--surface-hover);
}

.action-sheet .doc-badge {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.action-sheet .doc-badge.is-doc {
  background: #2563eb;
  border: 1px solid #1d4ed8;
  color: #ffffff;
}

.action-sheet .doc-badge.is-sheet {
  background: #16a34a;
  border: 1px solid #15803d;
  color: #ffffff;
}

[data-theme="dark"] .action-sheet .doc-badge.is-sheet {
  background: #38bdf8;
  border-color: #0ea5e9;
  color: #082f49;
}

.action-sheet .doc-badge.is-import {
  background: var(--panel-2);
  border: 1px dashed var(--muted);
  color: var(--muted);
}

.action-sheet .word-glyph {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;
}

.sheet-opt-text {
  display: grid;
  gap: 2px;
}

.sheet-opt-text strong {
  font-size: 15px;
}

.sheet-opt-text .muted {
  font-size: 12px;
}

.sheet-cancel {
  margin-top: 4px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 180ms ease;
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}
</style>
