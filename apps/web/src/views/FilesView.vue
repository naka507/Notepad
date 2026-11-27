<script setup lang="ts">
import {
  PERMISSIONS,
  type Category,
  type FileItem,
  type SheetWorkbook,
  type SiteConfig,
  type UserQuotaSummary
} from "@notepad/core"
import {
  Download,
  File as FileIcon,
  Link2,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onMounted, onUnmounted, ref, watch, type Component } from "vue"
import { useRouter } from "vue-router"
import { ApiError, api } from "@/api/client"
import CategoryPicker from "@/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import ShareDialog from "@/components/ShareDialog.vue"
import SheetEditor from "@/components/SheetEditor.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { importDocxToHtml, importSpreadsheetFile } from "@/utils/docConverters"
import { formatBytes } from "@/utils/format"

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()
const router = useRouter()

const selectedCategory = ref<string>("all")
const searchQuery = ref("")

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const pickerRef = ref<InstanceType<typeof CategoryPicker> | null>(null)
const assignCreatedToCurrent = ref(false)

const siteConfig = ref<SiteConfig | null>(null)
const files = ref<FileItem[]>([])
const loadingFiles = ref(false)
const selectedFileId = ref("")
const quota = ref<UserQuotaSummary | null>(null)
const uploading = ref(false)
const uploadPercent = ref(0)
const dragOver = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const renameOpen = ref(false)
const renameValue = ref("")
const shareOpen = ref(false)

const loadingOfficePreview = ref(false)
const docxPreviewHtml = ref("")
const sheetPreviewData = ref<SheetWorkbook | null>(null)

const canShare = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const selectedFile = computed(() => files.value.find((f) => f.id === selectedFileId.value) ?? null)

const quotaText = computed(() => {
  const q = quota.value ?? auth.user?.quota
  if (!q) return ""
  if (q.unlimited) return t("ws.quotaUnlimited", { count: q.usedFileCount })
  return t("ws.quotaUsed", { count: q.usedFileCount, max: q.maxFileCount ?? 0 })
})

const quotaRatio = computed(() => {
  const q = quota.value ?? auth.user?.quota
  if (!q || q.unlimited || !q.maxFileCount) return 0
  return Math.min(100, Math.round((q.usedFileCount / q.maxFileCount) * 100))
})

function lockReasonText(file: FileItem): string {
  if (file.accessStatus === "locked_size") return t("ws.lockedSize")
  if (file.accessStatus === "locked_quota") return t("ws.lockedQuota")
  return t("ws.lockedRole")
}

function isPreviewableImage(mime: string) {
  return ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"].includes(
    mime.toLowerCase()
  )
}

function isPreviewablePdf(mime: string) {
  return mime.toLowerCase() === "application/pdf"
}

function isPreviewableDocx(file: FileItem) {
  const lower = file.filename.toLowerCase()
  return (
    lower.endsWith(".docx") ||
    file.mimeType.toLowerCase() === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
}

function isPreviewableSpreadsheet(file: FileItem) {
  const lower = file.filename.toLowerCase()
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    file.mimeType.toLowerCase().includes("spreadsheetml") ||
    file.mimeType.toLowerCase() === "text/csv"
  )
}

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
    const res = await api.listCategories("file")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    await handleApiError(err)
  }
}

async function loadFiles(keepSelection = true) {
  loadingFiles.value = true
  try {
    const res = await api.listFiles({
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {})
    })
    files.value = res.items
    quota.value = res.quota
    if (!keepSelection || !files.value.some((f) => f.id === selectedFileId.value)) {
      selectedFileId.value = files.value[0]?.id ?? ""
    }
  } catch (err) {
    await handleApiError(err)
  } finally {
    loadingFiles.value = false
  }
}

async function handleFileSelection(fileList: FileList | null) {
  if (!fileList || fileList.length === 0 || uploading.value) return
  const catId =
    selectedCategory.value !== "all" && selectedCategory.value !== "default"
      ? selectedCategory.value
      : null

  uploading.value = true
  try {
    for (const file of Array.from(fileList)) {
      uploadPercent.value = 0
      const uploaded = await api.uploadFile(file, {
        categoryId: catId,
        onProgress: (p) => {
          uploadPercent.value = p
        }
      })
      selectedFileId.value = uploaded.id
    }
    await Promise.all([loadFiles(true), loadCategories(), auth.loadSession()])
  } catch (err) {
    await handleApiError(err)
  } finally {
    uploading.value = false
    uploadPercent.value = 0
    if (fileInput.value) fileInput.value.value = ""
  }
}

function onDropFiles(event: DragEvent) {
  dragOver.value = false
  void handleFileSelection(event.dataTransfer?.files ?? null)
}

async function updateSelectedFileCategory(categoryId: string | null) {
  if (!selectedFile.value || selectedFile.value.accessStatus !== "active") return
  try {
    await api.updateFile(selectedFile.value.id, { categoryId })
    await Promise.all([loadFiles(true), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

function onFileCategorySelect(event: Event) {
  if (!selectedFile.value) return
  const val = (event.target as HTMLSelectElement).value
  if (val === "__create__") {
    assignCreatedToCurrent.value = true
    ;(event.target as HTMLSelectElement).value = selectedFile.value.categoryId ?? ""
    pickerRef.value?.openCreate()
    return
  }
  void updateSelectedFileCategory(val || null)
}

async function onCategoryCreated(category: Category) {
  if (assignCreatedToCurrent.value && selectedFile.value) {
    assignCreatedToCurrent.value = false
    await updateSelectedFileCategory(category.id)
  }
}

async function onCategoriesChanged() {
  await Promise.all([loadCategories(), loadFiles(true)])
}

function openRenameDialog(file: FileItem) {
  renameValue.value = file.filename
  renameOpen.value = true
}

async function submitRename() {
  if (!selectedFile.value || !renameValue.value.trim()) return
  try {
    await api.updateFile(selectedFile.value.id, {
      filename: renameValue.value.trim()
    })
    renameOpen.value = false
    await loadFiles(true)
  } catch (err) {
    await handleApiError(err)
  }
}

async function removeFile(file: FileItem) {
  const confirmed = await confirmDialog({
    title: t("common.delete"),
    message: t("ws.confirmDeleteFile", { name: file.filename }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  try {
    await api.deleteFile(file.id)
    await Promise.all([loadFiles(false), loadCategories(), auth.loadSession()])
  } catch (err) {
    await handleApiError(err)
  }
}

watch(
  selectedFile,
  async (file) => {
    docxPreviewHtml.value = ""
    sheetPreviewData.value = null
    if (!file || file.accessStatus !== "active") return
    const isDocx = isPreviewableDocx(file)
    const isSheet = isPreviewableSpreadsheet(file)
    if (!isDocx && !isSheet) return

    loadingOfficePreview.value = true
    try {
      const response = await fetch(api.fileContentUrl(file.id), { credentials: "include" })
      if (!response.ok) return
      const buffer = await response.arrayBuffer()
      if (selectedFile.value?.id !== file.id) return
      if (isDocx) {
        docxPreviewHtml.value = await importDocxToHtml(buffer)
      } else {
        sheetPreviewData.value = await importSpreadsheetFile(buffer)
      }
    } catch {
      // ignore invalid office file
    } finally {
      loadingOfficePreview.value = false
    }
  },
  { immediate: true }
)

let searchDebounce: number | undefined
watch(searchQuery, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => {
    void loadFiles(true)
  }, 240)
})

watch(selectedCategory, () => {
  void loadFiles(true)
})

onMounted(async () => {
  const [cfg] = await Promise.all([api.config().catch(() => null), loadCategories()])
  siteConfig.value = cfg
  await loadFiles(false)
})

onUnmounted(() => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
})
</script>

<template>
  <main class="workspace-page">
    <section class="list-pane">
      <div class="pane-toolbar">
        <CategoryPicker
          ref="pickerRef"
          v-model="selectedCategory"
          scope="file"
          :categories="categories"
          :default-count="defaultCount"
          @changed="onCategoriesChanged"
          @created="onCategoryCreated"
        />

        <button class="icon-button compact-icon" type="button" :title="t('ws.upload')" @click="fileInput?.click()">
          <Upload :size="16" />
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadFiles(true)">
          <RefreshCw :class="{ spin: loadingFiles }" :size="15" />
        </button>
      </div>

      <div class="search-bar">
        <Search :size="14" class="search-icon" />
        <input v-model.trim="searchQuery" class="search-input" :placeholder="t('common.search')" />
      </div>

      <div
        class="item-scroll"
        :class="{ 'drag-active': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDropFiles"
      >
        <input
          ref="fileInput"
          type="file"
          multiple
          hidden
          @change="handleFileSelection(($event.target as HTMLInputElement).files)"
        />

        <div v-if="uploading" class="upload-progress">
          <span>{{ t("ws.uploading", { percent: uploadPercent }) }}</span>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${uploadPercent}%` }" />
          </div>
        </div>

        <div v-if="loadingFiles" class="empty-state">
          <Loader2 class="spin" :size="18" />
        </div>
        <div v-else-if="!files.length" class="empty-state">
          <Upload :size="20" />
          <span>{{ t("ws.dropHint") }}</span>
        </div>
        <TransitionGroup v-else tag="div" name="list-slide">
          <div
            v-for="file in files"
            :key="file.id"
            class="item-row"
            :class="{ active: file.id === selectedFileId, locked: file.accessStatus !== 'active' }"
            role="button"
            tabindex="0"
            @click="selectedFileId = file.id"
          >
            <div class="item-main">
              <div class="item-head">
                <Lock v-if="file.accessStatus !== 'active'" :size="13" class="lock-icon" />
                <FileIcon v-else :size="13" />
                <strong>{{ file.filename }}</strong>
              </div>
              <div class="file-meta-line">
                <span>{{ formatBytes(file.size) }}</span>
                <span
                  v-if="file.accessStatus !== 'active'"
                  class="lock-badge"
                  :title="lockReasonText(file)"
                >
                  {{ t("ws.locked") }}
                </span>
              </div>
            </div>
            <button class="row-action-btn" type="button" :title="t('common.delete')" @click.stop="removeFile(file)">
              <Trash2 :size="14" />
            </button>
          </div>
        </TransitionGroup>
      </div>

      <footer class="quota-bar">
        <div class="quota-top">
          <span>{{ t("nav.files") }}</span>
          <strong>{{ quotaText }}</strong>
        </div>
        <div v-if="quota && !quota.unlimited" class="progress-track">
          <div class="progress-fill" :style="{ width: `${quotaRatio}%` }" />
        </div>
      </footer>
    </section>

    <section class="detail-pane">
      <div v-if="!selectedFile" class="empty-state full-center">
        <span>{{ t("ws.selectFile") }}</span>
        <button class="button" type="button" :disabled="uploading" @click="fileInput?.click()">
          <Upload :size="15" />
          {{ t("ws.upload") }}
        </button>
      </div>

      <div v-else class="file-detail">
        <header class="detail-toolbar">
          <div class="file-title-wrap">
            <Lock v-if="selectedFile.accessStatus !== 'active'" :size="18" class="lock-icon" />
            <FileIcon v-else :size="18" />
            <h2>{{ selectedFile.filename }}</h2>
          </div>

          <div class="toolbar-actions">
            <template v-if="selectedFile.accessStatus === 'active'">
              <select
                :value="selectedFile.categoryId ?? ''"
                class="select mini-select"
                :title="t('ws.category')"
                @change="onFileCategorySelect"
              >
                <option value="">{{ t("common.defaultCategory") }}</option>
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
                <option value="__create__">{{ t("common.newCategoryOption") }}</option>
              </select>

              <button
                class="icon-button compact-icon"
                type="button"
                :title="t('ws.rename')"
                @click="openRenameDialog(selectedFile)"
              >
                <Pencil :size="15" />
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
              <a class="button compact-btn link-btn" :href="api.fileContentUrl(selectedFile.id, true)" download>
                <Download :size="15" />
                {{ t("ws.download") }}
              </a>
            </template>
            <button
              class="icon-button compact-icon danger-icon"
              type="button"
              :title="t('common.delete')"
              @click="removeFile(selectedFile)"
            >
              <Trash2 :size="15" />
            </button>
          </div>
        </header>

        <div class="file-meta-bar">
          <span>{{ formatBytes(selectedFile.size) }}</span>
          <span>·</span>
          <span>{{ selectedFile.mimeType }}</span>
          <span>·</span>
          <span>{{ formatDateTime(selectedFile.createdAt) }}</span>
        </div>

        <div v-if="selectedFile.accessStatus !== 'active'" class="empty-state full-center">
          <Lock :size="28" />
          <strong>{{ t("ws.locked") }}</strong>
          <span class="muted">{{ lockReasonText(selectedFile) }}</span>
        </div>

        <div v-else class="file-preview-box">
          <img
            v-if="isPreviewableImage(selectedFile.mimeType)"
            :src="api.fileContentUrl(selectedFile.id)"
            :alt="selectedFile.filename"
            class="preview-image"
          />
          <iframe
            v-else-if="isPreviewablePdf(selectedFile.mimeType)"
            :src="api.fileContentUrl(selectedFile.id)"
            class="preview-frame"
          />
          <div v-else-if="loadingOfficePreview" class="empty-state">
            <Loader2 class="spin" :size="20" />
          </div>
          <div v-else-if="docxPreviewHtml" class="office-doc-preview markdown-body" v-html="docxPreviewHtml" />
          <div v-else-if="sheetPreviewData" class="office-sheet-preview">
            <SheetEditor :model-value="sheetPreviewData" readonly :allow-export="false" />
          </div>
          <div v-else class="empty-state">
            <FileIcon :size="36" />
            <span>{{ selectedFile.filename }}</span>
          </div>
        </div>
      </div>
    </section>

    <UiDialog v-model="renameOpen" width="400px" align-center>
      <template #header>
        <div class="dialog-title">
          <Pencil :size="17" />
          <span>{{ t("ws.rename") }}</span>
        </div>
      </template>
      <form id="rename-file-form" class="dialog-form" @submit.prevent="submitRename">
        <input v-model.trim="renameValue" class="input" maxlength="255" required />
      </form>
      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="renameOpen = false">{{ t("common.cancel") }}</button>
          <button class="button" type="submit" form="rename-file-form">{{ t("common.save") }}</button>
        </div>
      </template>
    </UiDialog>

    <ShareDialog
      v-if="selectedFile"
      v-model="shareOpen"
      target-type="file"
      :target-id="selectedFile.id"
      :target-title="selectedFile.filename"
      :site-config="siteConfig"
    />
  </main>
</template>

<style scoped>
.workspace-page {
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

.link-btn {
  text-decoration: none;
}

.danger-icon:hover {
  color: var(--danger);
  border-color: rgba(185, 28, 28, 0.3);
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
  transition: background-color var(--dur-fast) var(--ease-out);
}

.item-scroll.drag-active {
  background: var(--surface-hover);
  box-shadow: inset 0 0 0 2px var(--accent);
}

.upload-progress {
  padding: 10px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
  display: grid;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.progress-track {
  height: 4px;
  border-radius: 999px;
  background: var(--surface-strong);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 180ms var(--ease-out);
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

.item-row.locked {
  opacity: 0.72;
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

.item-head strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lock-icon {
  flex-shrink: 0;
  color: var(--warning);
}

.file-meta-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}

.lock-badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--warning-bg);
  color: var(--warning);
  font-size: 11px;
  font-weight: 700;
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

.quota-bar {
  padding: 10px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  display: grid;
  gap: 6px;
}

.quota-top {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.quota-top strong {
  color: var(--text);
}

.full-center {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
}

.file-detail {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}

.file-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-title-wrap h2 {
  margin: 0;
  font-size: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mini-select {
  width: 126px;
  height: 32px;
  min-height: 32px;
  line-height: 30px;
  font-size: 12px;
  padding: 0 8px;
  border-radius: 6px;
}

.file-meta-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
  font-size: 12px;
  color: var(--muted);
}

.file-preview-box {
  flex: 1;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--panel-2);
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--panel);
}

.preview-frame {
  width: 100%;
  height: 100%;
  min-height: 440px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.office-doc-preview {
  width: min(820px, 100%);
  min-height: 100%;
  padding: 24px 32px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.office-sheet-preview {
  width: 100%;
  height: 100%;
  min-height: 440px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
}

.dialog-form {
  display: grid;
  gap: 10px;
}

@media (max-width: 820px) {
  .workspace-page {
    width: min(100% - 24px, 100%);
    height: auto;
    grid-template-columns: 1fr;
  }

  .list-pane {
    max-height: 44vh;
  }

  .detail-pane {
    min-height: 55vh;
  }
}
</style>
