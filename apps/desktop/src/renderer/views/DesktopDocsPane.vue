<script setup lang="ts">
import {
  PERMISSIONS,
  type Category,
  type CategoryScope,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
  type SheetWorkbook,
  type SiteConfig
} from "@notepad/core"
import {
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2
} from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { ApiError, api } from "@/api/client"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import DocEditor from "@web/components/DocEditor.vue"
import ShareDialog from "@web/components/ShareDialog.vue"
import SheetEditor from "@web/components/SheetEditor.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"
import { extractDocExcerpt } from "@/utils/docConverters"
import { extractSheetExcerpt } from "@/utils/sheetFormula"

const props = defineProps<{
  docType: DocumentType
}>()

const auth = useAuthStore()
const sync = useSyncStore()

const isSheet = computed(() => props.docType === "sheet")
const categoryScope = computed<CategoryScope>(() => (isSheet.value ? "sheet" : "document"))

const listWidth = ref(270)
const dragging = ref(false)
const sidebarCollapsed = ref(false)
const docView = ref<"archived" | "trash">("archived")
const selectedCategory = ref<string>("all")
const searchQuery = ref("")

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const pickerRef = ref<InstanceType<typeof CategoryPicker> | null>(null)
const assignCreatedToCurrent = ref(false)
const siteConfig = ref<SiteConfig | null>(null)

const documents = ref<DocumentSummary[]>([])
const loadingDocs = ref(false)
const selectedDocId = ref("")
const selectedDoc = ref<DocumentDetail | null>(null)
const loadingDoc = ref(false)

const editorTitle = ref("")
const editorContent = ref<Record<string, unknown>>({})
const editorCategoryId = ref<string | null>(null)
const saveState = ref<"idle" | "saving" | "saved">("idle")
const shareOpen = ref(false)
let saveTimer: number | undefined

const canShare = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const createLabel = computed(() => (isSheet.value ? t("docs.newSheet") : t("docs.newWord")))
const emptyListLabel = computed(() => (isSheet.value ? t("docs.emptySheet") : t("docs.emptyWord")))
const selectOrCreateLabel = computed(() =>
  isSheet.value ? t("docs.selectOrCreateSheet") : t("docs.selectOrCreateWord")
)

function startResize(event: MouseEvent) {
  dragging.value = true
  const startX = event.clientX
  const startW = listWidth.value
  const onMove = (e: MouseEvent) => {
    listWidth.value = Math.max(230, Math.min(420, startW + (e.clientX - startX)))
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener("mousemove", onMove)
    window.removeEventListener("mouseup", onUp)
  }
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onUp)
}

async function loadCategories() {
  try {
    const res = await api.listCategories(categoryScope.value)
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

async function loadDocuments(keepSelection = true) {
  loadingDocs.value = true
  try {
    const res = await api.listDocuments({
      view: docView.value,
      docType: props.docType,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {})
    })
    documents.value = res.items
    if (!keepSelection || !documents.value.some((d) => d.id === selectedDocId.value)) {
      const firstId = documents.value[0]?.id ?? ""
      if (firstId) await openDoc(firstId)
      else {
        selectedDocId.value = ""
        selectedDoc.value = null
      }
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  } finally {
    loadingDocs.value = false
  }
}

async function openDoc(id: string) {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  selectedDocId.value = id
  loadingDoc.value = true
  saveState.value = "idle"
  try {
    const res = await api.getDocument(id)
    selectedDoc.value = res.document
    editorTitle.value = res.document.title
    editorContent.value = res.document.content
    editorCategoryId.value = res.document.categoryId
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  } finally {
    loadingDoc.value = false
  }
}

async function createDoc() {
  docView.value = "archived"
  try {
    const catId =
      selectedCategory.value !== "all" && selectedCategory.value !== "default"
        ? selectedCategory.value
        : null
    const res = await api.createDocument({ docType: props.docType, title: "", categoryId: catId })
    await Promise.all([loadDocuments(false), loadCategories(), sync.syncNow()])
    await openDoc(res.document.id)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

function scheduleSave() {
  if (!selectedDoc.value || selectedDoc.value.deletedAt !== null) return
  saveState.value = "saving"
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void persistDoc(), 650)
}

function onContentUpdate(nextContent: Record<string, unknown>) {
  editorContent.value = nextContent
  scheduleSave()
}

async function persistDoc() {
  const doc = selectedDoc.value
  if (!doc || doc.deletedAt !== null) return
  saveState.value = "saving"
  try {
    const excerpt =
      doc.docType === "sheet"
        ? extractSheetExcerpt(editorContent.value as unknown as SheetWorkbook)
        : extractDocExcerpt(editorContent.value)
    const res = await api.updateDocument(doc.id, {
      title: editorTitle.value,
      content: editorContent.value,
      excerpt,
      categoryId: editorCategoryId.value,
      baseVersion: doc.version
    })
    selectedDoc.value = res.document
    saveState.value = "saved"
    const idx = documents.value.findIndex((i) => i.id === res.document.id)
    if (idx !== -1) {
      documents.value[idx] = {
        ...documents.value[idx]!,
        title: res.document.title,
        excerpt: res.document.excerpt,
        categoryId: res.document.categoryId,
        version: res.document.version,
        updatedAt: res.document.updatedAt
      }
    }
    void loadCategories()
  } catch (err) {
    saveState.value = "idle"
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.warning(t("ws.conflict"))
      await openDoc(doc.id)
      return
    }
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

function onDocCategorySelect(event: Event) {
  const val = (event.target as HTMLSelectElement).value
  if (val === "__create__") {
    assignCreatedToCurrent.value = true
    ;(event.target as HTMLSelectElement).value = editorCategoryId.value ?? ""
    pickerRef.value?.openCreate()
    return
  }
  editorCategoryId.value = val || null
  void persistDoc()
}

async function onCategoryCreated(category: Category) {
  if (assignCreatedToCurrent.value && selectedDoc.value) {
    assignCreatedToCurrent.value = false
    editorCategoryId.value = category.id
    await persistDoc()
  }
}

async function togglePin() {
  if (!selectedDoc.value) return
  const res = await api.updateDocument(selectedDoc.value.id, { isPinned: !selectedDoc.value.isPinned })
  selectedDoc.value = res.document
  await loadDocuments(true)
}

async function removeDoc(doc: DocumentSummary | DocumentDetail) {
  const inTrash = doc.deletedAt !== null
  const confirmed = await confirmDialog({
    title: inTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: inTrash ? t("ws.confirmPermanentDelete") : t("ws.confirmDeleteNote"),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  if (inTrash) await api.permanentDeleteDocument(doc.id)
  else await api.deleteDocument(doc.id)
  await Promise.all([loadDocuments(false), loadCategories(), sync.syncNow()])
}

async function restoreDoc(doc: DocumentDetail) {
  await api.restoreDocument(doc.id)
  await Promise.all([loadDocuments(false), loadCategories(), sync.syncNow()])
}

let searchDebounce: number | undefined
watch(searchQuery, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => void loadDocuments(true), 220)
})
watch(selectedCategory, () => {
  docView.value = "archived"
  void loadDocuments(true)
})
watch(docView, () => void loadDocuments(true))

onMounted(async () => {
  const [cfg] = await Promise.all([api.config().catch(() => null), loadCategories()])
  siteConfig.value = cfg
  await loadDocuments(false)
})

onUnmounted(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchDebounce) window.clearTimeout(searchDebounce)
})

defineExpose({ createNew: createDoc, openById: openDoc, refresh: () => loadDocuments(true) })
</script>

<template>
  <div class="desktop-split">
    <aside v-show="!sidebarCollapsed" class="desktop-list-col" :style="{ width: `${listWidth}px` }">
      <div class="pane-toolbar">
        <CategoryPicker
          ref="pickerRef"
          v-model="selectedCategory"
          :scope="categoryScope"
          :categories="categories"
          :default-count="defaultCount"
          @changed="loadCategories(); loadDocuments(true)"
          @created="onCategoryCreated"
        />
        <button class="icon-button compact-icon" type="button" :title="createLabel" @click="createDoc">
          <FilePlus2 :size="15" />
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadDocuments(true)">
          <RefreshCw :class="{ spin: loadingDocs }" :size="14" />
        </button>
      </div>

      <div class="sub-tabs">
        <button :class="{ active: docView === 'archived' }" type="button" @click="docView = 'archived'">
          {{ t("ws.archived") }}
        </button>
        <button :class="{ active: docView === 'trash' }" type="button" @click="docView = 'trash'">
          {{ t("ws.trash") }}
        </button>
      </div>

      <div class="search-bar">
        <Search :size="13" class="muted" />
        <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
      </div>

      <div class="item-scroll">
        <div v-if="loadingDocs && !documents.length" class="empty-state"><Loader2 class="spin" :size="18" /></div>
        <div v-else-if="!documents.length" class="empty-state">{{ emptyListLabel }}</div>
        <div
          v-for="doc in documents"
          :key="doc.id"
          class="item-row"
          :class="{ active: doc.id === selectedDocId }"
          @click="openDoc(doc.id)"
        >
          <div class="item-main">
            <div class="item-head">
              <Pin v-if="doc.isPinned" :size="11" />
              <FileSpreadsheet v-if="isSheet" :size="12" class="muted" />
              <FileText v-else :size="12" class="muted" />
              <strong>{{ doc.title || t("ws.noteTitle") }}</strong>
            </div>
            <span class="item-sub">{{ doc.excerpt || formatDateTime(doc.updatedAt) }}</span>
          </div>
          <button class="row-del" type="button" :title="t('common.delete')" @click.stop="removeDoc(doc)">
            <Trash2 :size="13" />
          </button>
        </div>
      </div>
    </aside>

    <div v-show="!sidebarCollapsed" class="split-resizer" :class="{ dragging }" @mousedown="startResize" />

    <section class="desktop-detail-col">
      <div v-if="loadingDoc" class="empty-state full-center"><Loader2 class="spin" :size="20" /></div>
      <div v-else-if="!selectedDoc" class="empty-state full-center">
        <span>{{ selectOrCreateLabel }}</span>
        <button class="button" type="button" @click="createDoc">
          <FileSpreadsheet v-if="isSheet" :size="15" />
          <FileText v-else :size="15" />
          {{ createLabel }}
        </button>
      </div>

      <div v-else class="editor-shell">
        <header class="detail-toolbar">
          <button
            class="icon-button compact-icon"
            type="button"
            :title="sidebarCollapsed ? t('docs.showList') : t('docs.focusMode')"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <PanelLeftOpen v-if="sidebarCollapsed" :size="15" />
            <PanelLeftClose v-else :size="15" />
          </button>

          <input
            v-model="editorTitle"
            class="title-input"
            :placeholder="t('ws.noteTitle')"
            :disabled="selectedDoc.deletedAt !== null"
            @input="scheduleSave"
          />

          <div class="toolbar-actions">
            <span v-if="saveState === 'saving'" class="save-ind"><span class="pulse-dot" />{{ t("common.saving") }}</span>
            <span v-else-if="saveState === 'saved'" class="save-ind muted">{{ t("common.saved") }}</span>

            <select
              v-if="selectedDoc.deletedAt === null"
              :value="editorCategoryId ?? ''"
              class="select mini-select"
              @change="onDocCategorySelect"
            >
              <option value="">{{ t("common.defaultCategory") }}</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              <option value="__create__">{{ t("common.newCategoryOption") }}</option>
            </select>

            <template v-if="selectedDoc.deletedAt === null">
              <button
                class="icon-button compact-icon"
                :class="{ active: selectedDoc.isPinned }"
                type="button"
                @click="togglePin"
              >
                <Pin :size="14" />
              </button>
              <button v-if="canShare" class="icon-button compact-icon" type="button" @click="shareOpen = true">
                <Link2 :size="14" />
              </button>
            </template>
            <button v-else class="ghost-button compact-btn" type="button" @click="restoreDoc(selectedDoc)">
              <RotateCcw :size="13" />
              {{ t("ws.restore") }}
            </button>

            <button class="icon-button compact-icon danger-icon" type="button" @click="removeDoc(selectedDoc)">
              <Trash2 :size="14" />
            </button>
          </div>
        </header>

        <DocEditor
          v-if="!isSheet"
          :model-value="editorContent"
          :title="editorTitle || t('ws.noteTitle')"
          :readonly="selectedDoc.deletedAt !== null"
          @update:model-value="onContentUpdate"
        />

        <SheetEditor
          v-else
          :model-value="(editorContent as unknown as SheetWorkbook)"
          :title="editorTitle || t('ws.noteTitle')"
          :readonly="selectedDoc.deletedAt !== null"
          @update:model-value="(val) => onContentUpdate(val as unknown as Record<string, unknown>)"
        />
      </div>
    </section>

    <ShareDialog
      v-if="selectedDoc"
      v-model="shareOpen"
      target-type="document"
      :target-id="selectedDoc.id"
      :target-title="editorTitle || t('ws.noteTitle')"
      :site-config="siteConfig"
    />
  </div>
</template>

<style scoped>
.pane-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.compact-icon {
  width: 30px;
  min-height: 30px;
  border-radius: 6px;
}

.compact-btn {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.danger-icon:hover {
  color: var(--danger);
}

.sub-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1px solid var(--line);
}

.sub-tabs button {
  height: 28px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.sub-tabs button.active {
  background: var(--panel);
  color: var(--accent);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
}

.search-bar input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 12px;
}

.item-scroll {
  flex: 1;
  overflow: auto;
}

.item-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 24px;
  align-items: center;
  gap: 6px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
}

.item-row:hover,
.item-row.active {
  background: var(--surface-hover);
}

.item-row.active {
  box-shadow: inset 3px 0 0 var(--accent);
}

.item-main {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.item-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.item-head strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-del {
  width: 24px;
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.item-row:hover .row-del {
  opacity: 1;
}

.row-del:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.full-center {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
}

.editor-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.detail-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--line);
}

.title-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 17px;
  font-weight: 750;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.save-ind {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
}

.mini-select {
  width: 120px;
  height: 30px;
  min-height: 30px;
  line-height: 28px;
  font-size: 12px;
  padding: 0 7px;
  border-radius: 6px;
}
</style>
