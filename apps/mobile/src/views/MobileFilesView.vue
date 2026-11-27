<script setup lang="ts">
import type { Category, FileItem, SheetWorkbook, UserQuotaSummary } from "@notepad/core"
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Link2,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from "@lucide/vue"
import CategoryPicker from "@web/components/CategoryPicker.vue"
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
import { downloadBlob, importDocxToHtml, importSpreadsheetFile } from "@/utils/docConverters"
import { formatBytes } from "@/utils/format"

const emit = defineEmits<{
  "detail-change": [open: boolean]
}>()

const auth = useAuthStore()
const sync = useSyncStore()

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const selectedCategory = ref("all")
const searchQuery = ref("")
const showSearch = ref(false)
const files = ref<FileItem[]>([])
const quota = ref<UserQuotaSummary | null>(null)
const loadingFiles = ref(false)
const activeFile = ref<FileItem | null>(null)
const shareOpen = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadPercent = ref(0)
const uploadName = ref("")

const previewLoading = ref(false)
const previewError = ref("")
const previewBlobUrl = ref<string | null>(null)
const previewDocxHtml = ref("")
const previewSheet = ref<SheetWorkbook | null>(null)

let searchTimer: number | null = null

const canShare = computed(() => auth.can("share:manage"))

watch(
  () => Boolean(activeFile.value),
  (open) => emit("detail-change", open),
  { immediate: true }
)

function isImage(mime: string) {
  return mime.startsWith("image/")
}

function isPdf(mime: string) {
  return mime === "application/pdf"
}

function isDocx(file: FileItem) {
  return file.filename.toLowerCase().endsWith(".docx")
}

function isSpreadsheet(file: FileItem) {
  const name = file.filename.toLowerCase()
  return name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")
}

function lockReasonText(file: FileItem) {
  if (file.accessStatus === "locked_size") return t("ws.lockedSize")
  if (file.accessStatus === "locked_quota") return t("ws.lockedQuota")
  if (file.accessStatus === "locked_role") return t("ws.lockedRole")
  return ""
}

function revokePreviewUrl() {
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value)
    previewBlobUrl.value = null
  }
}

function closeDetail() {
  revokePreviewUrl()
  previewDocxHtml.value = ""
  previewSheet.value = null
  activeFile.value = null
}

async function loadCategories() {
  try {
    const res = await api.listCategories("file")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch {
    categories.value = sync.categories
      .filter((c) => c.scope === "file" && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
  }
}

async function loadFiles() {
  loadingFiles.value = true
  try {
    const res = await api.listFiles({
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value ? { q: searchQuery.value } : {})
    })
    files.value = res.items
    quota.value = res.quota
  } catch {
    const q = searchQuery.value.toLowerCase()
    files.value = sync.files
      .filter((f) => f.deletedAt === null)
      .filter((f) => !q || f.filename.toLowerCase().includes(q))
  } finally {
    loadingFiles.value = false
  }
}

async function openFile(file: FileItem) {
  void hapticImpact("light")
  revokePreviewUrl()
  previewDocxHtml.value = ""
  previewSheet.value = null
  previewError.value = ""
  activeFile.value = file

  if (file.accessStatus !== "active") return
  if (!isImage(file.mimeType) && !isPdf(file.mimeType) && !isDocx(file) && !isSpreadsheet(file)) return

  previewLoading.value = true
  try {
    const blob = await api.fetchFileBlob(file.id)
    if (isImage(file.mimeType) || isPdf(file.mimeType)) {
      previewBlobUrl.value = URL.createObjectURL(blob)
    } else if (isDocx(file)) {
      previewDocxHtml.value = await importDocxToHtml(await blob.arrayBuffer())
    } else if (isSpreadsheet(file)) {
      const f = new File([blob], file.filename, { type: file.mimeType })
      previewSheet.value = await importSpreadsheetFile(f)
    }
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : "Preview unavailable"
  } finally {
    previewLoading.value = false
  }
}

async function onUploadPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = Array.from(input.files ?? [])
  input.value = ""
  if (!picked.length) return

  const catId =
    selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
      ? selectedCategory.value
      : null

  uploading.value = true
  try {
    for (const file of picked) {
      uploadName.value = file.name
      uploadPercent.value = 5
      await api.uploadFile(file, catId, (pct) => {
        uploadPercent.value = pct
      })
    }
    void hapticImpact("medium")
    await Promise.all([loadCategories(), loadFiles(), sync.pull()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Upload failed")
  } finally {
    uploading.value = false
    uploadPercent.value = 0
    uploadName.value = ""
  }
}

async function downloadFile(file: FileItem) {
  try {
    const blob = await api.fetchFileBlob(file.id)
    downloadBlob(blob, file.filename)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Download failed")
  }
}

async function changeCategory(file: FileItem, categoryId: string | null) {
  const res = await api.updateFile(file.id, { categoryId })
  activeFile.value = res.file
  await Promise.all([loadCategories(), loadFiles(), sync.pull()])
}

async function deleteActive() {
  if (!activeFile.value) return
  const confirmed = await confirmDialog({
    title: t("common.delete"),
    message: t("ws.confirmDeleteFile", { name: activeFile.value.filename }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  await api.deleteFile(activeFile.value.id)
  closeDetail()
  await Promise.all([loadCategories(), loadFiles(), sync.pull()])
}

watch(selectedCategory, () => {
  void loadFiles()
})

watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadFiles(), 240)
})

onMounted(() => {
  void Promise.all([loadCategories(), loadFiles()])
})

onBeforeUnmount(() => {
  revokePreviewUrl()
  if (searchTimer) window.clearTimeout(searchTimer)
})

defineExpose({
  closeDetail,
  hasOpenDetail: () => Boolean(activeFile.value)
})
</script>

<template>
  <div class="m-files-shell">
    <!-- MASTER LIST -->
    <template v-if="!activeFile">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <Folder :size="19" />
            <h1 class="mobile-topbar-title">{{ t("nav.files") }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <button class="m-icon-btn" type="button" @click="showSearch = !showSearch">
              <Search :size="18" />
            </button>
            <button class="m-icon-btn" type="button" @click="loadFiles">
              <RefreshCw :class="{ spin: loadingFiles }" :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div class="mobile-stage">
        <div class="mobile-scroll with-fab">
          <div v-if="quota" class="m-card quota-strip">
            <span>{{ formatBytes(quota.usedBytes) }}</span>
            <span>
              {{
                quota.unlimited
                  ? t("ws.quotaUnlimited", { count: quota.usedFileCount })
                  : `${t("ws.quotaUsed", { count: quota.usedFileCount, max: quota.maxFileCount ?? 0 })} · ${formatBytes(quota.maxFileSize ?? 0)}`
              }}
            </span>
          </div>

          <div v-if="uploading" class="m-card upload-banner">
            <div class="upload-top">
              <span class="upload-name">{{ uploadName }}</span>
              <span>{{ uploadPercent }}%</span>
            </div>
            <div class="upload-track">
              <div class="upload-fill" :style="{ width: `${uploadPercent}%` }" />
            </div>
          </div>

          <div class="list-controls">
            <CategoryPicker
              v-model="selectedCategory"
              scope="file"
              :categories="categories"
              :default-count="defaultCount"
              @changed="loadCategories(); loadFiles()"
            />
            <div v-if="showSearch" class="m-search-row">
              <Search :size="15" class="muted" />
              <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
            </div>
          </div>

          <div v-if="loadingFiles && !files.length" class="m-empty">
            <Loader2 class="spin" :size="22" />
          </div>

          <div v-else-if="!files.length" class="m-empty">
            <Folder :size="34" />
            <p>{{ t("ws.noFiles") }}</p>
          </div>

          <div v-else class="file-card-list">
            <article
              v-for="item in files"
              :key="item.id"
              class="m-card file-card"
              :class="{ locked: item.accessStatus !== 'active' }"
              @click="openFile(item)"
            >
              <div class="file-ico">
                <Lock v-if="item.accessStatus !== 'active'" :size="17" />
                <ImageIcon v-else-if="isImage(item.mimeType)" :size="17" />
                <FileSpreadsheet v-else-if="isSpreadsheet(item)" :size="17" />
                <FileText v-else-if="isDocx(item) || isPdf(item.mimeType)" :size="17" />
                <FileIcon v-else :size="17" />
              </div>
              <div class="file-meta">
                <strong>{{ item.filename }}</strong>
                <span class="file-sub">
                  {{ formatBytes(item.size) }} · {{ formatDateTime(item.createdAt) }}
                </span>
              </div>
              <span v-if="item.accessStatus !== 'active'" class="locked-pill">{{ t("ws.locked") }}</span>
            </article>
          </div>
        </div>

        <input ref="fileInput" type="file" multiple hidden @change="onUploadPicked" />
        <button class="mobile-fab" type="button" :disabled="uploading" @click="fileInput?.click()">
          <Upload :size="18" />
          <span>{{ t("ws.upload") }}</span>
        </button>
      </div>
    </template>

    <!-- DETAIL PREVIEW -->
    <template v-else>
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <button class="m-icon-btn" type="button" @click="closeDetail">
              <ArrowLeft :size="20" />
            </button>
            <h1 class="mobile-topbar-title">{{ activeFile.filename }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <button
              v-if="activeFile.accessStatus === 'active'"
              class="m-icon-btn"
              type="button"
              @click="downloadFile(activeFile)"
            >
              <Download :size="17" />
            </button>
            <button
              v-if="canShare && activeFile.accessStatus === 'active'"
              class="m-icon-btn"
              type="button"
              @click="shareOpen = true"
            >
              <Link2 :size="17" />
            </button>
            <button class="m-icon-btn danger-ico" type="button" @click="deleteActive">
              <Trash2 :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div class="file-detail-body">
        <div class="file-info-bar">
          <span class="muted">{{ formatBytes(activeFile.size) }} · {{ formatDateTime(activeFile.createdAt) }}</span>
          <select
            :value="activeFile.categoryId ?? ''"
            class="cat-mini-select"
            @change="changeCategory(activeFile, ($event.target as HTMLSelectElement).value || null)"
          >
            <option value="">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </div>

        <div v-if="activeFile.accessStatus !== 'active'" class="m-empty">
          <Lock :size="36" />
          <strong>{{ t("ws.locked") }}</strong>
          <p class="muted">{{ lockReasonText(activeFile) }}</p>
        </div>

        <div v-else-if="previewLoading" class="m-empty">
          <Loader2 class="spin" :size="22" />
        </div>

        <div v-else-if="previewError" class="m-empty">
          <p>{{ previewError }}</p>
        </div>

        <div v-else-if="previewBlobUrl && isImage(activeFile.mimeType)" class="preview-image-wrap">
          <img :src="previewBlobUrl" :alt="activeFile.filename" />
        </div>

        <iframe
          v-else-if="previewBlobUrl && isPdf(activeFile.mimeType)"
          :src="previewBlobUrl"
          class="preview-frame"
          title="PDF Preview"
        />

        <div v-else-if="previewDocxHtml" class="preview-docx markdown-body" v-html="previewDocxHtml" />

        <div v-else-if="previewSheet" class="preview-doc-wrap">
          <SheetEditor :model-value="previewSheet" :title="activeFile.filename" :readonly="true" />
        </div>

        <div v-else class="m-empty">
          <FileIcon :size="36" />
          <p>{{ activeFile.mimeType || "Binary file" }}</p>
          <button class="m-pill-btn" type="button" @click="downloadFile(activeFile)">
            <Download :size="15" />
            {{ t("ws.download") }}
          </button>
        </div>
      </div>

      <ShareDialog
        v-model="shareOpen"
        target-type="file"
        :target-id="activeFile.id"
        :target-title="activeFile.filename"
        :site-config="auth.siteConfig"
      />
    </template>
  </div>
</template>

<style scoped>
.m-files-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.quota-strip {
  padding: 9px 12px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.upload-banner {
  padding: 10px 12px;
  margin-bottom: 10px;
  display: grid;
  gap: 6px;
}

.upload-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.upload-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-track {
  height: 4px;
  border-radius: 999px;
  background: var(--panel-2);
  overflow: hidden;
}

.upload-fill {
  height: 100%;
  background: var(--accent);
  transition: width 160ms linear;
}

.list-controls {
  display: grid;
  gap: 10px;
  margin-bottom: 12px;
}

.file-card-list {
  display: grid;
  gap: 8px;
}

.file-card {
  padding: 12px 13px;
  display: flex;
  align-items: center;
  gap: 11px;
  cursor: pointer;
}

.file-card:active {
  transform: scale(0.985);
}

.file-card.locked {
  opacity: 0.72;
}

.file-ico {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}

.file-meta {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.file-meta strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-sub {
  font-size: 12px;
  color: var(--muted);
}

.locked-pill {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  flex-shrink: 0;
}

.danger-ico:active {
  color: var(--danger);
}

.file-detail-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}

.file-info-bar {
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.cat-mini-select {
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
}

.preview-image-wrap {
  flex: 1;
  overflow: auto;
  display: grid;
  place-items: center;
  padding: 16px;
  background: var(--bg);
}

.preview-image-wrap img {
  max-width: 100%;
  max-height: 75dvh;
  border-radius: 10px;
  object-fit: contain;
}

.preview-frame {
  flex: 1;
  width: 100%;
  border: 0;
}

.preview-docx {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.preview-doc-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
