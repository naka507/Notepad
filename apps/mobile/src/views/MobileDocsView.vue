<script setup lang="ts">
import type {
  Category,
  CategoryScope,
  DocumentDetail,
  DocumentSummary,
  DocumentType,
  SheetWorkbook
} from "@notepad/core"
import {
  ArrowLeft,
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Pin,
  RefreshCw,
  RotateCcw,
  Search,
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
import { formatDateTime, t } from "@/i18n"
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

const docType = ref<DocumentType>("doc")
const categories = ref<Category[]>([])
const defaultCount = ref(0)
const selectedCategory = ref("all")
const docView = ref<"archived" | "trash">("archived")
const searchQuery = ref("")
const showSearch = ref(false)

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

const categoryScope = computed<CategoryScope>(() => (docType.value === "sheet" ? "sheet" : "document"))
const canShare = computed(() => auth.can("share:manage"))
const acceptImport = computed(() => (docType.value === "sheet" ? ".xlsx,.xls,.csv" : ".docx"))

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

async function loadCategories() {
  try {
    const res = await api.listCategories(categoryScope.value)
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch {
    categories.value = sync.categories
      .filter((c) => c.scope === categoryScope.value && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
  }
}

async function loadDocuments() {
  loadingDocs.value = true
  try {
    const res = await api.listDocuments({
      type: docType.value,
      view: docView.value,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value ? { q: searchQuery.value } : {})
    })
    documents.value = res.items
  } catch {
    const q = searchQuery.value.toLowerCase()
    documents.value = sync.documents
      .filter((d) => d.docType === docType.value)
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

async function createDoc() {
  void hapticImpact("medium")
  try {
    const catId =
      selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
        ? selectedCategory.value
        : null
    const res = await api.createDocument({
      docType: docType.value,
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
    const catId =
      selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
        ? selectedCategory.value
        : null
    const baseTitle = file.name.replace(/\.[^.]+$/, "")
    let content: Record<string, unknown>
    if (docType.value === "sheet") {
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
      docType: docType.value,
      title: baseTitle,
      categoryId: catId,
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

watch(docType, () => {
  selectedCategory.value = "all"
  void Promise.all([loadCategories(), loadDocuments()])
})

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
    <!-- MASTER LIST -->
    <template v-if="!activeDoc">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <FileSpreadsheet v-if="docType === 'sheet'" :size="19" />
            <FileText v-else :size="19" />
            <h1 class="mobile-topbar-title">{{ docType === "sheet" ? t("nav.sheets") : t("nav.docs") }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <input ref="importInput" type="file" :accept="acceptImport" hidden @change="onImportPicked" />
            <button class="m-icon-btn" type="button" @click="importInput?.click()">
              <Upload :size="17" />
            </button>
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
            <div class="m-segmented">
              <button :class="{ active: docType === 'doc' }" type="button" @click="docType = 'doc'">
                <FileText :size="14" />
                {{ t("nav.docs") }}
              </button>
              <button :class="{ active: docType === 'sheet' }" type="button" @click="docType = 'sheet'">
                <FileSpreadsheet :size="14" />
                {{ t("nav.sheets") }}
              </button>
            </div>

            <div class="filter-row">
              <div class="cat-wrap">
                <CategoryPicker
                  v-model="selectedCategory"
                  :scope="categoryScope"
                  :categories="categories"
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
            <FileSpreadsheet v-if="docType === 'sheet'" :size="34" />
            <FileText v-else :size="34" />
            <p>{{ docType === "sheet" ? t("docs.emptySheet") : t("docs.emptyWord") }}</p>
          </div>

          <div v-else class="doc-card-list">
            <article
              v-for="item in documents"
              :key="item.id"
              class="m-card doc-card"
              @click="openDocument(item.id)"
            >
              <div class="doc-card-icon">
                <FileSpreadsheet v-if="item.docType === 'sheet'" :size="18" />
                <FileText v-else :size="18" />
              </div>
              <div class="doc-card-main">
                <div class="doc-card-head">
                  <strong>{{ item.title || t("ws.noteTitle") }}</strong>
                  <Pin v-if="item.isPinned" :size="13" />
                </div>
                <p v-if="item.excerpt" class="doc-excerpt">{{ item.excerpt }}</p>
                <span class="doc-time">{{ formatDateTime(item.updatedAt) }}</span>
              </div>
            </article>
          </div>
        </div>

        <button v-if="docView !== 'trash'" class="mobile-fab icon-only" type="button" @click="createDoc">
          <FilePlus2 :size="22" />
        </button>
      </div>
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
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
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
  align-items: flex-start;
  gap: 11px;
  cursor: pointer;
}

.doc-card:active {
  transform: scale(0.985);
}

.doc-card-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  flex-shrink: 0;
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
