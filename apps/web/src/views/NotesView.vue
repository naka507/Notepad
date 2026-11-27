<script setup lang="ts">
import {
  PERMISSIONS,
  type Category,
  type NoteDetail,
  type NoteSummary,
  type SiteConfig
} from "@notepad/core"
import {
  Eye,
  FilePlus2,
  Link2,
  Loader2,
  Pencil,
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
import ShareDialog from "@/components/ShareDialog.vue"
import { formatDateTime, t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { renderSafeMarkdown } from "@/utils/format"

const auth = useAuthStore()
const router = useRouter()

type NoteView = "archived" | "trash"

const noteView = ref<NoteView>("archived")
const selectedCategory = ref<string>("all")
const searchQuery = ref("")

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const pickerRef = ref<InstanceType<typeof CategoryPicker> | null>(null)
const assignCreatedToCurrent = ref(false)

const siteConfig = ref<SiteConfig | null>(null)
const notes = ref<NoteSummary[]>([])
const loadingNotes = ref(false)
const selectedNoteId = ref("")
const selectedNote = ref<NoteDetail | null>(null)
const loadingNote = ref(false)
const editorTitle = ref("")
const editorContent = ref("")
const editorCategoryId = ref<string | null>(null)
const editorMode = ref<"edit" | "preview">("edit")
const saveState = ref<"idle" | "saving" | "saved">("idle")
let saveTimer: number | undefined

const shareOpen = ref(false)
let lastSyncSeq = -1
let syncInterval: number | undefined

const canShare = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const renderedMarkdown = computed(() => renderSafeMarkdown(editorContent.value))

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
    const res = await api.listCategories("note")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch (err) {
    await handleApiError(err)
  }
}

async function loadNotes(keepSelection = true) {
  loadingNotes.value = true
  try {
    const res = await api.listNotes({
      view: noteView.value,
      ...(selectedCategory.value !== "all" ? { categoryId: selectedCategory.value } : {}),
      ...(searchQuery.value.trim() ? { q: searchQuery.value.trim() } : {})
    })
    notes.value = res.items
    if (!keepSelection || !notes.value.some((n) => n.id === selectedNoteId.value)) {
      const firstId = notes.value[0]?.id ?? ""
      if (firstId) {
        await openNote(firstId)
      } else {
        selectedNoteId.value = ""
        selectedNote.value = null
      }
    }
  } catch (err) {
    await handleApiError(err)
  } finally {
    loadingNotes.value = false
  }
}

async function openNote(id: string) {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  selectedNoteId.value = id
  loadingNote.value = true
  saveState.value = "idle"
  try {
    const res = await api.getNote(id)
    selectedNote.value = res.note
    editorTitle.value = res.note.title
    editorContent.value = res.note.content
    editorCategoryId.value = res.note.categoryId
  } catch (err) {
    await handleApiError(err)
  } finally {
    loadingNote.value = false
  }
}

async function createNote() {
  noteView.value = "archived"
  try {
    const catId =
      selectedCategory.value !== "all" && selectedCategory.value !== "default"
        ? selectedCategory.value
        : null
    const res = await api.createNote({ title: "", content: "", categoryId: catId })
    await Promise.all([loadNotes(false), loadCategories()])
    await openNote(res.note.id)
    editorMode.value = "edit"
  } catch (err) {
    await handleApiError(err)
  }
}

function scheduleSave() {
  if (!selectedNote.value || selectedNote.value.deletedAt !== null) return
  saveState.value = "saving"
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persistNote()
  }, 600)
}

async function persistNote() {
  const note = selectedNote.value
  if (!note || note.deletedAt !== null) return
  saveState.value = "saving"
  try {
    const res = await api.updateNote(note.id, {
      title: editorTitle.value,
      content: editorContent.value,
      categoryId: editorCategoryId.value,
      baseVersion: note.version
    })
    selectedNote.value = res.note
    saveState.value = "saved"
    const idx = notes.value.findIndex((item) => item.id === res.note.id)
    if (idx !== -1) {
      notes.value[idx] = {
        ...notes.value[idx]!,
        title: res.note.title,
        excerpt: res.note.excerpt,
        categoryId: res.note.categoryId,
        version: res.note.version,
        updatedAt: res.note.updatedAt
      }
    }
    await loadCategories()
  } catch (err) {
    saveState.value = "idle"
    if (err instanceof ApiError && err.status === 409) {
      ElMessage.warning(t("ws.conflict"))
      await openNote(note.id)
      return
    }
    await handleApiError(err)
  }
}

function onNoteCategorySelect(event: Event) {
  const val = (event.target as HTMLSelectElement).value
  if (val === "__create__") {
    assignCreatedToCurrent.value = true
    ;(event.target as HTMLSelectElement).value = editorCategoryId.value ?? ""
    pickerRef.value?.openCreate()
    return
  }
  editorCategoryId.value = val || null
  void persistNote()
}

async function onCategoryCreated(category: Category) {
  if (assignCreatedToCurrent.value && selectedNote.value) {
    assignCreatedToCurrent.value = false
    editorCategoryId.value = category.id
    await persistNote()
  }
}

async function onCategoriesChanged() {
  await Promise.all([loadCategories(), loadNotes(true)])
}

async function togglePin() {
  if (!selectedNote.value) return
  try {
    const res = await api.updateNote(selectedNote.value.id, {
      isPinned: !selectedNote.value.isPinned
    })
    selectedNote.value = res.note
    await loadNotes(true)
  } catch (err) {
    await handleApiError(err)
  }
}

async function removeNote(note: NoteSummary | NoteDetail) {
  const inTrash = note.deletedAt !== null
  const confirmed = await confirmDialog({
    title: inTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: inTrash ? t("ws.confirmPermanentDelete") : t("ws.confirmDeleteNote"),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return

  try {
    if (inTrash) {
      await api.permanentDeleteNote(note.id)
    } else {
      await api.deleteNote(note.id)
    }
    await Promise.all([loadNotes(false), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

async function restoreNote(note: NoteDetail) {
  try {
    await api.restoreNote(note.id)
    await Promise.all([loadNotes(false), loadCategories()])
  } catch (err) {
    await handleApiError(err)
  }
}

async function probeSyncCursor() {
  if (document.visibilityState !== "visible") return
  try {
    const res = await api.syncCursor()
    if (lastSyncSeq !== -1 && res.currentSeq !== lastSyncSeq && saveState.value !== "saving") {
      await Promise.all([loadCategories(), loadNotes(true)])
    }
    lastSyncSeq = res.currentSeq
  } catch {
    // ignore transient errors
  }
}

let searchDebounce: number | undefined
watch(searchQuery, () => {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => {
    void loadNotes(true)
  }, 240)
})

watch(selectedCategory, () => {
  noteView.value = "archived"
  void loadNotes(true)
})

watch(noteView, () => {
  void loadNotes(true)
})

function onVisibilityChange() {
  if (document.visibilityState === "visible") void probeSyncCursor()
}

onMounted(async () => {
  const [cfg] = await Promise.all([api.config().catch(() => null), loadCategories()])
  siteConfig.value = cfg
  await loadNotes(false)
  await probeSyncCursor()
  document.addEventListener("visibilitychange", onVisibilityChange)
  syncInterval = window.setInterval(() => {
    void probeSyncCursor()
  }, 60_000)
})

onUnmounted(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchDebounce) window.clearTimeout(searchDebounce)
  if (syncInterval) window.clearInterval(syncInterval)
  document.removeEventListener("visibilitychange", onVisibilityChange)
})
</script>

<template>
  <main class="workspace-page">
    <section class="list-pane">
      <div class="pane-toolbar">
        <CategoryPicker
          ref="pickerRef"
          v-model="selectedCategory"
          scope="note"
          :categories="categories"
          :default-count="defaultCount"
          @changed="onCategoriesChanged"
          @created="onCategoryCreated"
        />

        <button class="icon-button compact-icon" type="button" :title="t('ws.newNote')" @click="createNote">
          <FilePlus2 :size="16" />
        </button>
        <button class="icon-button compact-icon" type="button" :title="t('common.refresh')" @click="loadNotes(true)">
          <RefreshCw :class="{ spin: loadingNotes }" :size="15" />
        </button>
      </div>

      <div class="sub-tabs">
        <button :class="{ active: noteView === 'archived' }" type="button" @click="noteView = 'archived'">
          {{ t("ws.archived") }}
        </button>
        <button :class="{ active: noteView === 'trash' }" type="button" @click="noteView = 'trash'">
          {{ t("ws.trash") }}
        </button>
      </div>

      <div class="search-bar">
        <Search :size="14" class="search-icon" />
        <input v-model.trim="searchQuery" class="search-input" :placeholder="t('common.search')" />
      </div>

      <div class="item-scroll">
        <div v-if="loadingNotes" class="empty-state">
          <Loader2 class="spin" :size="18" />
        </div>
        <div v-else-if="!notes.length" class="empty-state">{{ t("ws.noNotes") }}</div>
        <TransitionGroup v-else tag="div" name="list-slide">
          <div
            v-for="note in notes"
            :key="note.id"
            class="item-row"
            :class="{ active: note.id === selectedNoteId }"
            role="button"
            tabindex="0"
            @click="openNote(note.id)"
          >
            <div class="item-main">
              <div class="item-head">
                <Pin v-if="note.isPinned" :size="12" class="pin-icon" />
                <strong>{{ note.title || t("ws.noteTitle") }}</strong>
              </div>
              <span class="item-sub">{{ note.excerpt || formatDateTime(note.updatedAt) }}</span>
            </div>
            <button class="row-action-btn" type="button" :title="t('common.delete')" @click.stop="removeNote(note)">
              <Trash2 :size="14" />
            </button>
          </div>
        </TransitionGroup>
      </div>
    </section>

    <section class="detail-pane">
      <div v-if="loadingNote" class="empty-state full-center">
        <Loader2 class="spin" :size="20" />
      </div>
      <div v-else-if="!selectedNote" class="empty-state full-center">
        <span>{{ t("ws.selectNote") }}</span>
        <button class="button" type="button" @click="createNote">
          <FilePlus2 :size="15" />
          {{ t("ws.newNote") }}
        </button>
      </div>
      <div v-else class="note-editor">
        <header class="detail-toolbar">
          <input
            v-model="editorTitle"
            class="title-input"
            :placeholder="t('ws.noteTitle')"
            :disabled="selectedNote.deletedAt !== null"
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
              v-if="selectedNote.deletedAt === null"
              :value="editorCategoryId ?? ''"
              class="select mini-select"
              :title="t('ws.category')"
              @change="onNoteCategorySelect"
            >
              <option value="">{{ t("common.defaultCategory") }}</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
              <option value="__create__">{{ t("common.newCategoryOption") }}</option>
            </select>

            <button
              class="icon-button compact-icon"
              type="button"
              :title="editorMode === 'edit' ? t('ws.preview') : t('ws.edit')"
              @click="editorMode = editorMode === 'edit' ? 'preview' : 'edit'"
            >
              <Eye v-if="editorMode === 'edit'" :size="16" />
              <Pencil v-else :size="16" />
            </button>

            <template v-if="selectedNote.deletedAt === null">
              <button
                class="icon-button compact-icon"
                :class="{ active: selectedNote.isPinned }"
                type="button"
                :title="selectedNote.isPinned ? t('ws.unpin') : t('ws.pin')"
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
            <button v-else class="ghost-button compact-btn" type="button" @click="restoreNote(selectedNote)">
              <RotateCcw :size="14" />
              {{ t("ws.restore") }}
            </button>

            <button
              class="icon-button compact-icon danger-icon"
              type="button"
              :title="t('common.delete')"
              @click="removeNote(selectedNote)"
            >
              <Trash2 :size="15" />
            </button>
          </div>
        </header>

        <Transition name="page-fade" mode="out-in">
          <textarea
            v-if="editorMode === 'edit' && selectedNote.deletedAt === null"
            key="edit"
            v-model="editorContent"
            class="markdown-textarea"
            :placeholder="t('ws.notePlaceholder')"
            @input="scheduleSave"
          />
          <div v-else key="preview" class="markdown-preview markdown-body" v-html="renderedMarkdown" />
        </Transition>
      </div>
    </section>

    <ShareDialog
      v-if="selectedNote"
      v-model="shareOpen"
      target-type="note"
      :target-id="selectedNote.id"
      :target-title="editorTitle || t('ws.noteTitle')"
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

.item-head strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-icon {
  flex-shrink: 0;
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

.note-editor {
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
  margin-right: 4px;
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

.markdown-textarea {
  flex: 1;
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  padding: 18px 20px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
  background: var(--panel);
}

.markdown-preview {
  flex: 1;
  overflow: auto;
  padding: 18px 24px;
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
