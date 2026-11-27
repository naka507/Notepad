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
import { useRouter } from "vue-router"
import { ApiError, api } from "@/api/client"
import CategoryPicker from "@/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import DocEditor from "@/components/DocEditor.vue"
import ShareDialog from "@/components/ShareDialog.vue"
import SheetEditor from "@/components/SheetEditor.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { extractDocExcerpt } from "@/utils/docConverters"
import { extractSheetExcerpt } from "@/utils/sheetFormula"

const props = defineProps<{
  docType: DocumentType
}>()

const auth = useAuthStore()
const router = useRouter()

const isSheet = computed(() => props.docType === "sheet")
const categoryScope = computed<CategoryScope>(() => (isSheet.value ? "sheet" : "document"))

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
let saveTimer: number | undefined

const shareOpen = ref(false)
const canShare = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))

const createLabel = computed(() => (isSheet.value ? t("docs.newSheet") : t("docs.newWord")))
const emptyListLabel = computed(() => (isSheet.value ? t("docs.emptySheet") : t("docs.emptyWord")))
const selectOrCreateLabel = computed(() =>
  isSheet.value ? t("docs.selectOrCreateSheet") : t("docs.selectOrCreateWord")
)

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
    const res = await api.listCategories(categoryScope.value)
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    await handleApiError(err)
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
      if (firstId) {
        await openDoc(firstId)
      } else {
        selectedDocId.value = ""
        selectedDoc.value = null
      }
    }
  } catch (err) {
    await handleApiError(err)
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
    await handleApiError(err)
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
    const res = await api.createDocument({
      docType: props.docType,
      title: "",
      categoryId: catId
    })
    await Promise.all([loadDocuments(false), loadCategories()])
    await openDoc(res.document.id)
  } catch (err) {
    await handleApiError(err)
  }
}

function scheduleSave() {
  if (!selectedDoc.value || selectedDoc.value.deletedAt !== null) return
  saveState.value = "saving"
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persistDoc()
  }, 700)
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
    const idx = documents.value.findIndex((item) => item.id === res.document.id)
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
    await loadCategories()
  } catch (err) {
    saveState.value = "idle"
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.warning(t("ws.conflict"))
      await openDoc(doc.id)
      return
    }
    await handleApiError(err)
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

async function onCategoriesChanged() {
  await Promise.all([loadCategories(), loadDocuments(true)])
}

async function togglePin() {
  if (!selectedDoc.value) return
  try {
    const res = await api.updateDocument(selectedDoc.value.id, {
      isPinned: !selectedDoc.value.isPinned
    })
    selectedDoc.value = res.document
    await loadDocuments(true)
  } catch (err) {
    await handleApiError(err)
  }
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

  try {
    if (inTrash) {
      await api.permanentDeleteDocument(doc.id)
    } else {
      await api.deleteDocument(doc.id)
    }
    await Promise.all([loadDocuments(false), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

async function restoreDoc(doc: DocumentDetail) {
  try {
    await api.restoreDocument(doc.id)
    await Promise.all([loadDocuments(false), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

let searchDebounce: number | undefined
watch(searchQuery, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => {
    void loadDocuments(true)
  }, 240)
})

watch(selectedCategory, () => {
  docView.value = "archived"
  void loadDocuments(true)
})

watch(docView, () => {
  void loadDocuments(true)
})

onMounted(async () => {
  const [cfg] = await Promise.all([api.config().catch(() => null), loadCategories()])
  siteConfig.value = cfg
  await loadDocuments(false)
})

onUnmounted(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchDebounce) window.clearTimeout(searchDebounce)
})
</script>

<template>
  <main class="docs-page" :class="{ collapsed: sidebarCollapsed }">
    <section v-show="!sidebarCollapsed" class="list-pane">
      <div class="pane-toolbar">
        <CategoryPicker
          ref="pickerRef"
          v-model="selectedCategory"
          :scope="categoryScope"
          :categories="categories"
          :default-count="defaultCount"
          @changed="onCategoriesChanged"
          @created="onCategoryCreated"
        />

        <button class="icon-button compact-icon" type="button" :title="createLabel" @click="createDoc">
          <FilePlus2 :size="16" />
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadDocuments(true)">
          <RefreshCw :class="{ spin: loadingDocs }" :size="15" />
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
        <Search :size="14" class="search-icon" />
        <input v-model.trim="searchQuery" class="search-input" :placeholder="t('common.search')" />
      </div>

      <div class="item-scroll">
        <div v-if="loadingDocs" class="empty-state">
          <Loader2 class="spin" :size="18" />
        </div>
        <div v-else-if="!documents.length" class="empty-state">{{ emptyListLabel }}</div>
        <TransitionGroup v-else tag="div" name="list-slide">
          <div
            v-for="doc in documents"
            :key="doc.id"
            class="item-row"
            :class="{ active: doc.id === selectedDocId }"
            role="button"
            tabindex="0"
            @click="openDoc(doc.id)"
          >
            <div class="item-main">
              <div class="item-head">
                <Pin v-if="doc.isPinned" :size="12" />
                <FileSpreadsheet v-if="isSheet" :size="13" class="type-icon" />
                <FileText v-else :size="13" class="type-icon" />
                <strong>{{ doc.title || t("ws.noteTitle") }}</strong>
              </div>
              <span class="item-sub">{{ doc.excerpt || formatDateTime(doc.updatedAt) }}</span>
            </div>
            <button class="row-action-btn" type="button" :title="t('common.delete')" @click.stop="removeDoc(doc)">
              <Trash2 :size="14" />
            </button>
          </div>
        </TransitionGroup>
      </div>
    </section>

    <section class="detail-pane">
      <div v-if="loadingDoc" class="empty-state full-center">
        <Loader2 class="spin" :size="20" />
      </div>
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
            <span v-if="saveState === 'saving'" class="save-indicator">
              <span class="pulse-dot" />
              {{ t("common.saving") }}
            </span>
            <span v-else-if="saveState === 'saved'" class="save-indicator muted">
              {{ t("common.saved") }}
            </span>

            <select
              v-if="selectedDoc.deletedAt === null"
              :value="editorCategoryId ?? ''"
              class="select mini-select"
              :title="t('ws.category')"
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
                :title="selectedDoc.isPinned ? t('ws.unpin') : t('ws.pin')"
                @click="togglePin"
              >
                <Pin :size="15" />
              </button>
              <button
                v-if="canShare"
                class="icon-button compact-icon"
                type="button"
                :title="t('ws.share')"
                @click="shareOpen = true"
              >
                <Link2 :size="15" />
              </button>
            </template>
            <button v-else class="ghost-button compact-btn" type="button" @click="restoreDoc(selectedDoc)">
              <RotateCcw :size="14" />
              {{ t("ws.restore") }}
            </button>

            <button
              class="icon-button compact-icon danger-icon"
              type="button"
              :title="t('common.delete')"
              @click="removeDoc(selectedDoc)"
            >
              <Trash2 :size="15" />
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
  </main>
</template>

<style scoped>
.docs-page {
  height: calc(100vh - 114px);
  min-height: 560px;
  width: min(1440px, calc(100% - 48px));
  margin: 18px auto 32px;
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  gap: 1px;
  background: var(--line);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.docs-page.collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.list-pane,
.detail-pane {
  min-width: 0;
  background: var(--panel);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pane-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.compact-icon {
  width: 32px;
  min-height: 32px;
  border-radius: 6px;
}

.compact-btn {
  min-height: 32px;
  padding: 0 10px;
  font-size: 13px;
  border-radius: 6px;
}

.danger-icon:hover {
  color: var(--danger);
  border-color: rgba(185, 28, 28, 0.3);
}

.sub-tabs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  border-bottom: 1px solid var(--line);
}

.sub-tabs button {
  height: 30px;
  border: 0;
  background: var(--panel-2);
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
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
}

.search-icon {
  color: var(--muted);
}

.search-input {
  width: 100%;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 13px;
}

.item-scroll {
  flex: 1;
  overflow: auto;
}

.item-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
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
  gap: 3px;
}

.item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.type-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.item-head strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-sub {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-action-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.item-row:hover .row-action-btn,
.item-row:focus-within .row-action-btn {
  opacity: 1;
}

.row-action-btn:hover {
  border-color: var(--accent);
  color: var(--danger);
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
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}

.title-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  font-size: 17px;
  font-weight: 750;
  color: var(--text);
  background: transparent;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.mini-select {
  width: 130px;
  height: 32px;
  min-height: 32px;
  line-height: 30px;
  font-size: 12px;
  padding: 0 8px;
  border-radius: 6px;
}

@media (max-width: 820px) {
  .docs-page {
    width: min(100% - 24px, 100%);
    height: auto;
    grid-template-columns: 1fr;
  }

  .list-pane {
    max-height: 44vh;
  }

  .detail-pane {
    min-height: 60vh;
  }
}
</style>
