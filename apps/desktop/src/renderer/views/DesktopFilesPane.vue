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
import { api } from "@/api/client"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import { confirmDialog } from "@/components/confirm"
import ShareDialog from "@web/components/ShareDialog.vue"
import SheetEditor from "@web/components/SheetEditor.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"
import { downloadBlob, importDocxToHtml, importSpreadsheetFile } from "@/utils/docConverters"
import { formatBytes } from "@/utils/format"

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()
const sync = useSyncStore()

const listWidth = ref(280)
const dragging = ref(false)
const selectedCategory = ref<string>("all")
const searchQuery = ref("")

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const pickerRef = ref<InstanceType<typeof CategoryPicker> | null>(null)
const assignCreatedToCurrent = ref(false)
const siteConfig = ref<SiteConfig | null>(null)

const files = ref<FileItem[]>([])
const quota = ref<UserQuotaSummary | null>(null)
const loadingFiles = ref(false)
const selectedFile = ref<FileItem | null>(null)
const dragOver = ref(false)
const uploadPercent = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const previewObjectUrl = ref("")
const loadingPreview = ref(false)
const docxPreviewHtml = ref("")
const sheetPreviewData = ref<SheetWorkbook | null>(null)

const renameOpen = ref(false)
const renameValue = ref("")
const shareOpen = ref(false)

const canShare = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const quotaRatio = computed(() => {
  if (!quota.value || quota.value.unlimited || !quota.value.maxFileCount) return 0
  return Math.min(100, Math.round((quota.value.usedFileCount / quota.value.maxFileCount) * 100))
})

function startResize(event: MouseEvent) {
  dragging.value = true
  const startX = event.clientX
  const startW = listWidth.value
  const onMove = (e: MouseEvent) => {
    listWidth.value = Math.max(230, Math.min(440, startW + (e.clientX - startX)))
  }
  const onUp = () => {
    dragging.value = false
    window.removeEventListener("mousemove", onMove)
    window.removeEventListener("mouseup", onUp)
  }
  window.addEventListener("mousemove", onMove)
  window.addEventListener("mouseup", onUp)
}

function revokePreviewUrl() {
  if (previewObjectUrl.value) {
    URL.revokeObjectURL(previewObjectUrl.value)
    previewObjectUrl.value = ""
  }
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
  return file.filename.toLowerCase().endsWith(".docx")
}

function isPreviewableSheet(file: FileItem) {
  const lower = file.filename.toLowerCase()
  return lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".csv")
}

function lockReasonText(file: FileItem) {
  if (file.accessStatus === "locked_size") return t("ws.lockedSize")
  if (file.accessStatus === "locked_quota") return t("ws.lockedQuota")
  if (file.accessStatus === "locked_role") return t("ws.lockedRole")
  return ""
}

async function loadCategories() {
  try {
    const res = await api.listCategories("file")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
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
    if (!keepSelection || !files.value.some((f) => f.id === selectedFile.value?.id)) {
      selectedFile.value = files.value[0] ?? null
    } else if (selectedFile.value) {
      selectedFile.value = files.value.find((f) => f.id === selectedFile.value?.id) ?? null
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  } finally {
    loadingFiles.value = false
  }
}

async function handleUploadFiles(fileList: FileList | File[]) {
  const items = Array.from(fileList)
  if (!items.length) return
  const catId =
    selectedCategory.value !== "all" && selectedCategory.value !== "default"
      ? selectedCategory.value
      : null
  try {
    for (const item of items) {
      uploadPercent.value = 1
      const uploaded = await api.uploadFile(item, {
        categoryId: catId,
        onProgress: (p) => {
          uploadPercent.value = p
        }
      })
      selectedFile.value = uploaded
    }
    await Promise.all([loadFiles(true), loadCategories(), sync.syncNow()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Upload failed")
  } finally {
    uploadPercent.value = null
    if (fileInput.value) fileInput.value.value = ""
  }
}

function onFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) void handleUploadFiles(input.files)
}

function onDrop(event: DragEvent) {
  dragOver.value = false
  if (event.dataTransfer?.files?.length) {
    void handleUploadFiles(event.dataTransfer.files)
  }
}

async function downloadSelectedFile(file: FileItem) {
  try {
    const blob = await api.fetchFileBlob(file.id, true)
    downloadBlob(blob, file.filename)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Download failed")
  }
}

function openRename() {
  if (!selectedFile.value) return
  renameValue.value = selectedFile.value.filename
  renameOpen.value = true
}

async function submitRename() {
  if (!selectedFile.value || !renameValue.value.trim()) return
  const res = await api.updateFile(selectedFile.value.id, { filename: renameValue.value.trim() })
  selectedFile.value = res.file
  renameOpen.value = false
  await loadFiles(true)
}

async function onFileCategorySelect(event: Event) {
  if (!selectedFile.value) return
  const val = (event.target as HTMLSelectElement).value
  if (val === "__create__") {
    assignCreatedToCurrent.value = true
    ;(event.target as HTMLSelectElement).value = selectedFile.value.categoryId ?? ""
    pickerRef.value?.openCreate()
    return
  }
  const res = await api.updateFile(selectedFile.value.id, { categoryId: val || null })
  selectedFile.value = res.file
  await Promise.all([loadFiles(true), loadCategories()])
}

async function onCategoryCreated(category: Category) {
  if (assignCreatedToCurrent.value && selectedFile.value) {
    assignCreatedToCurrent.value = false
    const res = await api.updateFile(selectedFile.value.id, { categoryId: category.id })
    selectedFile.value = res.file
    await Promise.all([loadFiles(true), loadCategories()])
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
  await api.deleteFile(file.id)
  await Promise.all([loadFiles(false), loadCategories(), sync.syncNow()])
}

watch(selectedFile, async (file) => {
  revokePreviewUrl()
  docxPreviewHtml.value = ""
  sheetPreviewData.value = null
  if (!file || file.accessStatus !== "active") return
  const needsPreview =
    isPreviewableImage(file.mimeType) ||
    isPreviewablePdf(file.mimeType) ||
    isPreviewableDocx(file) ||
    isPreviewableSheet(file)
  if (!needsPreview) return

  loadingPreview.value = true
  try {
    const blob = await api.fetchFileBlob(file.id, false)
    if (selectedFile.value?.id !== file.id) return
    if (isPreviewableImage(file.mimeType) || isPreviewablePdf(file.mimeType)) {
      previewObjectUrl.value = URL.createObjectURL(blob)
    } else if (isPreviewableDocx(file)) {
      docxPreviewHtml.value = await importDocxToHtml(new File([blob], file.filename, { type: file.mimeType }))
    } else if (isPreviewableSheet(file)) {
      sheetPreviewData.value = await importSpreadsheetFile(new File([blob], file.filename, { type: file.mimeType }))
    }
  } catch {
    // fallback to file summary card
  } finally {
    loadingPreview.value = false
  }
})

let searchDebounce: number | undefined
watch(searchQuery, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => void loadFiles(true), 220)
})
watch(selectedCategory, () => void loadFiles(true))

onMounted(async () => {
  const [cfg] = await Promise.all([api.config().catch(() => null), loadCategories()])
  siteConfig.value = cfg
  await loadFiles(false)
})

onUnmounted(() => {
  revokePreviewUrl()
  if (searchDebounce) window.clearTimeout(searchDebounce)
})

defineExpose({
  openById: (id: string) => {
    const hit = files.value.find((f) => f.id === id)
    if (hit) selectedFile.value = hit
  },
  refresh: () => loadFiles(true)
})
</script>

<template>
  <div class="desktop-split">
    <aside class="desktop-list-col" :style="{ width: `${listWidth}px` }">
      <div class="pane-toolbar">
        <CategoryPicker
          ref="pickerRef"
          v-model="selectedCategory"
          scope="file"
          :categories="categories"
          :default-count="defaultCount"
          @changed="loadCategories(); loadFiles(true)"
          @created="onCategoryCreated"
        />
        <input ref="fileInput" type="file" multiple hidden @change="onFileInputChange" />
        <button class="icon-button compact-icon" type="button" :title="t('ws.upload')" @click="fileInput?.click()">
          <Upload :size="15" />
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadFiles(true)">
          <RefreshCw :class="{ spin: loadingFiles }" :size="14" />
        </button>
      </div>

      <div class="search-bar">
        <Search :size="13" class="muted" />
        <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
      </div>

      <div
        class="item-scroll"
        :class="{ 'drag-active': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <div v-if="uploadPercent !== null" class="upload-progress">
          <span>{{ t("ws.uploading", { percent: uploadPercent }) }}</span>
          <div class="progress-track"><div class="progress-fill" :style="{ width: `${uploadPercent}%` }" /></div>
        </div>
        <div v-if="loadingFiles && !files.length" class="empty-state"><Loader2 class="spin" :size="18" /></div>
        <div v-else-if="!files.length" class="empty-state">
          <span>{{ t("ws.noFiles") }}</span>
          <span class="muted">{{ t("ws.dropHint") }}</span>
        </div>
        <div
          v-for="file in files"
          :key="file.id"
          class="item-row"
          :class="{ active: file.id === selectedFile?.id, locked: file.accessStatus !== 'active' }"
          @click="selectedFile = file"
        >
          <div class="item-main">
            <div class="item-head">
              <Lock v-if="file.accessStatus !== 'active'" :size="12" class="lock-icon" />
              <strong>{{ file.filename }}</strong>
            </div>
            <span class="item-sub">{{ formatBytes(file.size) }}</span>
          </div>
          <button class="row-del" type="button" :title="t('common.delete')" @click.stop="removeFile(file)">
            <Trash2 :size="13" />
          </button>
        </div>
      </div>

      <footer v-if="quota" class="quota-bar">
        <div class="quota-top">
          <span>{{ formatBytes(quota.usedBytes) }}</span>
          <strong>
            {{
              quota.unlimited
                ? t("ws.quotaUnlimited", { count: quota.usedFileCount })
                : t("ws.quotaUsed", { count: quota.usedFileCount, max: quota.maxFileCount ?? 0 })
            }}
          </strong>
        </div>
        <div v-if="!quota.unlimited" class="progress-track">
          <div class="progress-fill" :style="{ width: `${quotaRatio}%` }" />
        </div>
      </footer>
    </aside>

    <div class="split-resizer" :class="{ dragging }" @mousedown="startResize" />

    <section class="desktop-detail-col">
      <div v-if="!selectedFile" class="empty-state full-center">
        <span>{{ t("ws.selectFile") }}</span>
        <button class="button" type="button" @click="fileInput?.click()">
          <Upload :size="15" />
          {{ t("ws.upload") }}
        </button>
      </div>

      <div v-else class="file-detail">
        <header class="detail-toolbar">
          <div class="file-title-wrap">
            <FileIcon :size="17" />
            <h2>{{ selectedFile.filename }}</h2>
          </div>

          <div class="toolbar-actions">
            <select
              :value="selectedFile.categoryId ?? ''"
              class="select mini-select"
              @change="onFileCategorySelect"
            >
              <option value="">{{ t("common.defaultCategory") }}</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              <option value="__create__">{{ t("common.newCategoryOption") }}</option>
            </select>

            <button class="icon-button compact-icon" type="button" :title="t('ws.rename')" @click="openRename">
              <Pencil :size="14" />
            </button>
            <template v-if="selectedFile.accessStatus === 'active'">
              <button v-if="canShare" class="icon-button compact-icon" type="button" @click="shareOpen = true">
                <Link2 :size="14" />
              </button>
              <button class="button compact-btn" type="button" @click="downloadSelectedFile(selectedFile)">
                <Download :size="14" />
                {{ t("ws.download") }}
              </button>
            </template>
            <button class="icon-button compact-icon danger-icon" type="button" @click="removeFile(selectedFile)">
              <Trash2 :size="14" />
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
          <div v-if="loadingPreview" class="empty-state"><Loader2 class="spin" :size="20" /></div>
          <img
            v-else-if="previewObjectUrl && isPreviewableImage(selectedFile.mimeType)"
            :src="previewObjectUrl"
            :alt="selectedFile.filename"
            class="preview-image"
          />
          <iframe
            v-else-if="previewObjectUrl && isPreviewablePdf(selectedFile.mimeType)"
            :src="previewObjectUrl"
            class="preview-frame"
          />
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

    <UiDialog v-model="renameOpen" width="380px" align-center>
      <template #header>
        <div class="dialog-title"><Pencil :size="16" /><span>{{ t("ws.rename") }}</span></div>
      </template>
      <form id="desk-rename-form" @submit.prevent="submitRename">
        <input v-model.trim="renameValue" class="input" maxlength="255" required />
      </form>
      <template #footer>
        <div class="dialog-footer">
          <button class="ghost-button" type="button" @click="renameOpen = false">{{ t("common.cancel") }}</button>
          <button class="button" type="submit" form="desk-rename-form">{{ t("common.save") }}</button>
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

.item-scroll.drag-active {
  background: var(--surface-hover);
  box-shadow: inset 0 0 0 2px var(--accent);
}

.upload-progress {
  padding: 9px 10px;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 6px;
  font-size: 12px;
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

.item-row.locked {
  opacity: 0.7;
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
}

.lock-icon {
  color: var(--warning);
  flex-shrink: 0;
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
}

.quota-bar {
  padding: 9px 12px;
  border-top: 1px solid var(--line);
  display: grid;
  gap: 5px;
}

.quota-top {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
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
  gap: 10px;
  padding: 9px 16px;
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
  font-size: 15px;
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
  width: 120px;
  height: 30px;
  min-height: 30px;
  line-height: 28px;
  font-size: 12px;
  padding: 0 7px;
  border-radius: 6px;
}

.file-meta-bar {
  display: flex;
  gap: 8px;
  padding: 7px 16px;
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
</style>
