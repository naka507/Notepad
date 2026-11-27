import type {
  SyncCategoryRecord,
  SyncDocumentRecord,
  SyncFileRecord,
  SyncNoteRecord,
  TotpEntry
} from "@notepad/core"
import { defineStore } from "pinia"
import { ref } from "vue"
import { api } from "@/api/client"

const FALLBACK_CACHE_KEY = "notepad_desktop_sync_cache"

interface PersistedSyncCache {
  lastSeq: number
  syncedAt: number
  categories: SyncCategoryRecord[]
  notes: SyncNoteRecord[]
  documents: SyncDocumentRecord[]
  files: SyncFileRecord[]
  totpEntries: TotpEntry[]
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) map.set(item.id, item)
  return Array.from(map.values())
}

export const useSyncStore = defineStore("sync", () => {
  const status = ref<"idle" | "syncing" | "synced" | "offline">("idle")
  const lastSeq = ref(0)
  const lastSyncedAt = ref(0)
  const categories = ref<SyncCategoryRecord[]>([])
  const notes = ref<SyncNoteRecord[]>([])
  const documents = ref<SyncDocumentRecord[]>([])
  const files = ref<SyncFileRecord[]>([])
  const totpEntries = ref<TotpEntry[]>([])

  async function hydrateFromCache() {
    try {
      const raw = window.notepadDesktop
        ? ((await window.notepadDesktop.loadSyncCache()) as PersistedSyncCache | null)
        : (JSON.parse(localStorage.getItem(FALLBACK_CACHE_KEY) || "null") as PersistedSyncCache | null)
      if (!raw) return
      lastSeq.value = raw.lastSeq || 0
      lastSyncedAt.value = raw.syncedAt || 0
      categories.value = Array.isArray(raw.categories) ? raw.categories : []
      notes.value = Array.isArray(raw.notes) ? raw.notes : []
      documents.value = Array.isArray(raw.documents) ? raw.documents : []
      files.value = Array.isArray(raw.files) ? raw.files : []
      totpEntries.value = Array.isArray(raw.totpEntries) ? raw.totpEntries : []
    } catch {
      // ignore corrupted cache
    }
  }

  async function persistCache() {
    const payload: PersistedSyncCache = {
      lastSeq: lastSeq.value,
      syncedAt: lastSyncedAt.value,
      categories: categories.value,
      notes: notes.value,
      documents: documents.value,
      files: files.value,
      totpEntries: totpEntries.value
    }
    try {
      if (window.notepadDesktop) {
        await window.notepadDesktop.saveSyncCache(payload as unknown as Record<string, unknown>)
      } else {
        localStorage.setItem(FALLBACK_CACHE_KEY, JSON.stringify(payload))
      }
    } catch {
      // ignore write error
    }
  }

  async function syncNow(forceFull = false) {
    if (status.value === "syncing") return
    status.value = "syncing"
    try {
      let since = forceFull ? 0 : lastSeq.value
      let loops = 0
      let hasMore = true

      while (hasMore && loops < 10) {
        loops += 1
        const res = await api.syncPull(since, 150)
        if (res.fullResyncRequired || forceFull) {
          categories.value = res.changes.categories
          notes.value = res.changes.notes
          documents.value = res.changes.documents
          files.value = res.changes.files
          totpEntries.value = res.changes.totpEntries
          forceFull = false
        } else {
          categories.value = mergeById(categories.value, res.changes.categories)
          notes.value = mergeById(notes.value, res.changes.notes)
          documents.value = mergeById(documents.value, res.changes.documents)
          files.value = mergeById(files.value, res.changes.files)
          totpEntries.value = mergeById(totpEntries.value, res.changes.totpEntries)
        }
        since = res.nextSeq
        lastSeq.value = res.nextSeq
        hasMore = res.hasMore
      }

      lastSyncedAt.value = Date.now()
      status.value = "synced"
      await persistCache()
    } catch {
      status.value = "offline"
    }
  }

  async function clearAll() {
    lastSeq.value = 0
    lastSyncedAt.value = 0
    categories.value = []
    notes.value = []
    documents.value = []
    files.value = []
    totpEntries.value = []
    status.value = "idle"
    if (window.notepadDesktop) {
      await window.notepadDesktop.clearSyncCache()
    } else {
      localStorage.removeItem(FALLBACK_CACHE_KEY)
    }
  }

  return {
    status,
    lastSeq,
    lastSyncedAt,
    categories,
    notes,
    documents,
    files,
    totpEntries,
    hydrateFromCache,
    syncNow,
    clearAll
  }
})
