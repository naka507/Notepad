<script setup lang="ts">
import type { Category, NoteDetail, NoteSummary } from "@notepad/core"
import {
  ArrowLeft,
  Eye,
  FilePlus2,
  Link2,
  Loader2,
  Pencil,
  Pin,
  RefreshCw,
  RotateCcw,
  Search,
  StickyNote,
  Trash2
} from "@lucide/vue"
import CategoryPicker from "@web/components/CategoryPicker.vue"
import ShareDialog from "@web/components/ShareDialog.vue"
import DOMPurify from "dompurify"
import { ElMessage } from "element-plus/es/components/message/index"
import { marked } from "marked"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { currentLocale as locale, formatDateTime, t } from "@/i18n"
import { hapticImpact } from "@/native/bridge"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"

const emit = defineEmits<{
  "detail-change": [open: boolean]
}>()

const auth = useAuthStore()
const sync = useSyncStore()

const categories = ref<Category[]>([])
const defaultCount = ref(0)
const selectedCategory = ref("all")
const noteView = ref<"archived" | "trash">("archived")
const searchQuery = ref("")
const showSearch = ref(false)

const notes = ref<NoteSummary[]>([])
const loadingNotes = ref(false)
const activeNote = ref<NoteDetail | null>(null)
const loadingDetail = ref(false)
const noteTitle = ref("")
const noteContent = ref("")
const noteCategoryId = ref<string | null>(null)
const noteMode = ref<"edit" | "preview">("edit")
const savingState = ref<"idle" | "saving" | "saved" | "error">("idle")
const shareOpen = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)

let saveTimer: number | null = null
let searchTimer: number | null = null

const renderedMarkdown = computed(() =>
  DOMPurify.sanitize(marked.parse(noteContent.value || "", { async: false }) as string)
)

const canShare = computed(() => auth.can("share:manage"))

watch(
  () => Boolean(activeNote.value),
  (open) => emit("detail-change", open),
  { immediate: true }
)

function closeDetail() {
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
    void flushSave()
  }
  activeNote.value = null
}

function noteCategoryParam(): string | undefined {
  if (selectedCategory.value === "all") return undefined
  return selectedCategory.value
}

async function loadCategories() {
  try {
    const res = await api.listCategories("note")
    categories.value = res.categories
    defaultCount.value = res.defaultCount
  } catch {
    categories.value = sync.categories
      .filter((c) => c.scope === "note" && c.deletedAt === null)
      .map((c) => ({ ...c, itemCount: 0 }))
  }
}

async function loadNotes() {
  loadingNotes.value = true
  try {
    const catId = noteCategoryParam()
    const res = await api.listNotes({
      view: noteView.value,
      ...(catId ? { categoryId: catId } : {}),
      ...(searchQuery.value ? { q: searchQuery.value } : {})
    })
    notes.value = res.items
  } catch {
    const q = searchQuery.value.toLowerCase()
    notes.value = sync.notes
      .filter((n) => (noteView.value === "trash" ? n.deletedAt !== null : n.deletedAt === null))
      .filter((n) => {
        if (selectedCategory.value === "all") return true
        if (selectedCategory.value === "uncategorized") return n.categoryId === null
        return n.categoryId === selectedCategory.value
      })
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.updatedAt - a.updatedAt)
  } finally {
    loadingNotes.value = false
  }
}

async function openNote(id: string) {
  loadingDetail.value = true
  void hapticImpact("light")
  try {
    const res = await api.getNote(id)
    activeNote.value = res.note
    noteTitle.value = res.note.title
    noteContent.value = res.note.content
    noteCategoryId.value = res.note.categoryId
    noteMode.value = "edit"
    savingState.value = "idle"
  } catch {
    const cached = sync.notes.find((n) => n.id === id)
    if (cached) {
      activeNote.value = cached
      noteTitle.value = cached.title
      noteContent.value = cached.content
      noteCategoryId.value = cached.categoryId
      noteMode.value = "edit"
      savingState.value = "idle"
    }
  } finally {
    loadingDetail.value = false
  }
}

async function createNote() {
  void hapticImpact("medium")
  try {
    const catId =
      selectedCategory.value !== "all" && selectedCategory.value !== "uncategorized"
        ? selectedCategory.value
        : null
    const res = await api.createNote({ title: "", content: "", categoryId: catId })
    activeNote.value = res.note
    noteTitle.value = res.note.title
    noteContent.value = res.note.content
    noteCategoryId.value = res.note.categoryId
    noteMode.value = "edit"
    savingState.value = "idle"
    await Promise.all([loadCategories(), loadNotes(), sync.pull()])
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Failed to create note")
  }
}

function scheduleSave() {
  if (!activeNote.value || activeNote.value.deletedAt !== null) return
  savingState.value = "saving"
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flushSave(), 650)
}

async function flushSave() {
  if (!activeNote.value || activeNote.value.deletedAt !== null) return
  try {
    const res = await api.updateNote(activeNote.value.id, {
      title: noteTitle.value,
      content: noteContent.value,
      categoryId: noteCategoryId.value,
      baseVersion: activeNote.value.version
    })
    activeNote.value = res.note
    savingState.value = "saved"
    const idx = notes.value.findIndex((n) => n.id === res.note.id)
    if (idx !== -1) notes.value[idx] = res.note
    else await loadNotes()
    void sync.pull()
  } catch (err) {
    savingState.value = "error"
    ElMessage.error(err instanceof Error ? err.message : t("ws.conflict"))
  }
}

function insertSnippet(before: string, after = "") {
  const el = textareaRef.value
  if (!el) return
  const start = el.selectionStart ?? noteContent.value.length
  const end = el.selectionEnd ?? noteContent.value.length
  const selected = noteContent.value.slice(start, end)
  noteContent.value = noteContent.value.slice(0, start) + before + selected + after + noteContent.value.slice(end)
  scheduleSave()
  window.requestAnimationFrame(() => {
    el.focus()
    const pos = start + before.length + selected.length
    el.setSelectionRange(pos, pos)
  })
}

async function togglePin() {
  if (!activeNote.value) return
  const res = await api.updateNote(activeNote.value.id, { isPinned: !activeNote.value.isPinned })
  activeNote.value = res.note
  await loadNotes()
}

async function deleteActiveNote() {
  if (!activeNote.value) return
  const isTrash = activeNote.value.deletedAt !== null
  const confirmed = await confirmDialog({
    title: isTrash ? t("ws.permanentDelete") : t("common.delete"),
    message: isTrash ? t("ws.confirmPermanentDelete") : t("ws.confirmDeleteNote"),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  if (isTrash) await api.permanentDeleteNote(activeNote.value.id)
  else await api.deleteNote(activeNote.value.id)
  activeNote.value = null
  await Promise.all([loadCategories(), loadNotes(), sync.pull()])
}

async function restoreActiveNote() {
  if (!activeNote.value) return
  await api.restoreNote(activeNote.value.id)
  activeNote.value = null
  await Promise.all([loadCategories(), loadNotes(), sync.pull()])
}

watch([selectedCategory, noteView], () => {
  void loadNotes()
})

watch(searchQuery, () => {
  if (searchTimer) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => void loadNotes(), 240)
})

onMounted(() => {
  void Promise.all([loadCategories(), loadNotes()])
})

onBeforeUnmount(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
  if (searchTimer) window.clearTimeout(searchTimer)
})

defineExpose({
  closeDetail,
  hasOpenDetail: () => Boolean(activeNote.value)
})
</script>

<template>
  <div class="m-notes-shell">
    <!-- MASTER LIST -->
    <template v-if="!activeNote">
      <header class="mobile-topbar">
        <div class="mobile-topbar-inner">
          <div class="mobile-topbar-left">
            <StickyNote :size="19" />
            <h1 class="mobile-topbar-title">{{ t("ws.notes") }}</h1>
          </div>
          <div class="mobile-topbar-actions">
            <button class="m-icon-btn" type="button" @click="showSearch = !showSearch">
              <Search :size="18" />
            </button>
            <button class="m-icon-btn" type="button" @click="loadNotes">
              <RefreshCw :class="{ spin: loadingNotes }" :size="17" />
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
                  scope="note"
                  :categories="categories"
                  :default-count="defaultCount"
                  @changed="loadCategories(); loadNotes()"
                />
              </div>
              <div class="m-segmented view-seg">
                <button :class="{ active: noteView === 'archived' }" type="button" @click="noteView = 'archived'">
                  {{ t("ws.archived") }}
                </button>
                <button :class="{ active: noteView === 'trash' }" type="button" @click="noteView = 'trash'">
                  {{ t("ws.trash") }}
                </button>
              </div>
            </div>

            <div v-if="showSearch" class="m-search-row">
              <Search :size="15" class="muted" />
              <input v-model.trim="searchQuery" :placeholder="t('common.search')" />
            </div>
          </div>

          <div v-if="loadingNotes && !notes.length" class="m-empty">
            <Loader2 class="spin" :size="22" />
          </div>

          <div v-else-if="!notes.length" class="m-empty">
            <StickyNote :size="34" />
            <p>{{ t("ws.noNotes") }}</p>
          </div>

          <div v-else class="note-card-list">
            <article
              v-for="note in notes"
              :key="note.id"
              class="m-card note-card"
              @click="openNote(note.id)"
            >
              <div class="note-card-head">
                <strong>{{ note.title || t("ws.noteTitle") }}</strong>
                <Pin v-if="note.isPinned" :size="13" class="pin-ico" />
              </div>
              <p v-if="note.excerpt" class="note-excerpt">{{ note.excerpt }}</p>
              <span class="note-time">{{ formatDateTime(note.updatedAt) }}</span>
            </article>
          </div>
        </div>

        <button v-if="noteView !== 'trash'" class="mobile-fab icon-only" type="button" :title="t('ws.newNote')" @click="createNote">
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
                      : t("nav.notes")
              }}
            </span>
          </div>
          <div class="mobile-topbar-actions">
            <button
              class="m-icon-btn"
              type="button"
              :title="noteMode === 'edit' ? t('ws.preview') : t('ws.edit')"
              @click="noteMode = noteMode === 'edit' ? 'preview' : 'edit'"
            >
              <Eye v-if="noteMode === 'edit'" :size="18" />
              <Pencil v-else :size="18" />
            </button>
            <button
              v-if="activeNote.deletedAt === null"
              class="m-icon-btn"
              :class="{ bordered: activeNote.isPinned }"
              type="button"
              @click="togglePin"
            >
              <Pin :size="17" />
            </button>
            <button
              v-if="canShare && activeNote.deletedAt === null"
              class="m-icon-btn"
              type="button"
              @click="shareOpen = true"
            >
              <Link2 :size="17" />
            </button>
            <button
              v-if="activeNote.deletedAt !== null"
              class="m-icon-btn"
              type="button"
              @click="restoreActiveNote"
            >
              <RotateCcw :size="17" />
            </button>
            <button class="m-icon-btn danger-ico" type="button" @click="deleteActiveNote">
              <Trash2 :size="17" />
            </button>
          </div>
        </div>
      </header>

      <div v-if="loadingDetail" class="m-empty">
        <Loader2 class="spin" :size="22" />
      </div>

      <div v-else class="detail-body">
        <div class="detail-meta">
          <input
            v-model="noteTitle"
            class="detail-title-input"
            :placeholder="t('ws.noteTitle')"
            :disabled="activeNote.deletedAt !== null"
            @input="scheduleSave"
          />
          <select
            v-model="noteCategoryId"
            class="cat-mini-select"
            :disabled="activeNote.deletedAt !== null"
            @change="scheduleSave"
          >
            <option :value="null">{{ t("common.defaultCategory") }}</option>
            <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
          </select>
        </div>

        <textarea
          v-if="noteMode === 'edit'"
          ref="textareaRef"
          v-model="noteContent"
          class="detail-textarea"
          :placeholder="locale === 'zh-CN' ? '开始书写 Markdown 笔记…' : 'Write Markdown note…'"
          :disabled="activeNote.deletedAt !== null"
          @input="scheduleSave"
        />
        <div v-else class="detail-preview markdown-body" v-html="renderedMarkdown" />

        <!-- Mobile keyboard-adjacent quick Markdown toolbar -->
        <div v-if="noteMode === 'edit' && activeNote.deletedAt === null" class="md-quick-bar">
          <button type="button" @click="insertSnippet('# ')">H1</button>
          <button type="button" @click="insertSnippet('## ')">H2</button>
          <button type="button" @click="insertSnippet('**', '**')"><strong>B</strong></button>
          <button type="button" @click="insertSnippet('*', '*')"><em>I</em></button>
          <button type="button" @click="insertSnippet('- [ ] ')">☑</button>
          <button type="button" @click="insertSnippet('- ')">•</button>
          <button type="button" @click="insertSnippet('> ')">”</button>
          <button type="button" @click="insertSnippet('`', '`')">&lt;/&gt;</button>
        </div>
      </div>

      <ShareDialog
        v-model="shareOpen"
        target-type="note"
        :target-id="activeNote.id"
        :target-title="activeNote.title || t('ws.noteTitle')"
        :site-config="auth.siteConfig"
      />
    </template>
  </div>
</template>

<style scoped>
.m-notes-shell {
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

.note-card-list {
  display: grid;
  gap: 9px;
}

.note-card {
  padding: 13px 14px;
  display: grid;
  gap: 5px;
  cursor: pointer;
  transition: transform 120ms var(--ease-out);
}

.note-card:active {
  transform: scale(0.985);
}

.note-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.note-card-head strong {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-ico {
  color: var(--ink);
  flex-shrink: 0;
}

.note-excerpt {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;
}

.note-time {
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
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--line);
  display: grid;
  gap: 8px;
}

.detail-title-input {
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
  font-size: 19px;
  font-weight: 700;
  width: 100%;
}

.cat-mini-select {
  justify-self: start;
  height: 28px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
}

.detail-textarea {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.7;
  padding: 14px;
}

.detail-preview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px calc(24px + var(--safe-bottom));
}

.md-quick-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 12px calc(8px + var(--safe-bottom));
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  scrollbar-width: none;
}

.md-quick-bar::-webkit-scrollbar {
  display: none;
}

.md-quick-bar button {
  flex: 0 0 auto;
  min-width: 38px;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  font-size: 13px;
  cursor: pointer;
}

.md-quick-bar button:active {
  background: var(--surface-hover);
}
</style>
