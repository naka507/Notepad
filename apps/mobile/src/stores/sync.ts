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
import { storageGet, storageRemove, storageSet } from "@/native/bridge"

export interface MobileSyncCache {
  lastSeq: number
  lastSyncedAt: number | null
  categories: SyncCategoryRecord[]
  notes: SyncNoteRecord[]
  documents: SyncDocumentRecord[]
  files: SyncFileRecord[]
  totpEntries: TotpEntry[]
}

const SYNC_CACHE_KEY = "notepad_mobile_sync_cache_v1"

function upsertById<T extends { id: string }>(list: T[], incoming: T[]): T[] {
  const map = new Map(list.map((item) => [item.id, item]))
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return [...map.values()]
}

export const useSyncStore = defineStore("sync", () => {
  const lastSeq = ref(0)
  const lastSyncedAt = ref<number | null>(null)
  const syncing = ref(false)
  const online = ref(typeof navigator !== "undefined" ? navigator.onLine : true)
  const lastError = ref("")

  const categories = ref<SyncCategoryRecord[]>([])
  const notes = ref<SyncNoteRecord[]>([])
  const documents = ref<SyncDocumentRecord[]>([])
  const files = ref<SyncFileRecord[]>([])
  const totpEntries = ref<TotpEntry[]>([])

  let hydrated = false

  async function hydrateFromDisk() {
    if (hydrated) return
    hydrated = true
    try {
      const raw = await storageGet(SYNC_CACHE_KEY)
      if (!raw) return
      const loaded = JSON.parse(raw) as Partial<MobileSyncCache>
      lastSeq.value = loaded.lastSeq ?? 0
      lastSyncedAt.value = loaded.lastSyncedAt ?? null
      categories.value = loaded.categories ?? []
      notes.value = loaded.notes ?? []
      documents.value = loaded.documents ?? []
      files.value = loaded.files ?? []
      totpEntries.value = loaded.totpEntries ?? []
    } catch {
      // ignore corrupted cache
    }
  }

  async function persistToDisk() {
    const payload: MobileSyncCache = {
      lastSeq: lastSeq.value,
      lastSyncedAt: lastSyncedAt.value,
      categories: categories.value,
      notes: notes.value,
      documents: documents.value,
      files: files.value,
      totpEntries: totpEntries.value
    }
    try {
      await storageSet(SYNC_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore persistence errors
    }
  }

  async function pull(forceFull = false) {
    if (syncing.value) return
    syncing.value = true
    lastError.value = ""
    try {
      let since = forceFull ? 0 : lastSeq.value
      let hasMore = true
      let guard = 0
      let resetting = forceFull

      while (hasMore && guard < 20) {
        guard += 1
        const res = await api.syncPull(since, 120)
        if (res.fullResyncRequired || resetting) {
          categories.value = res.changes.categories
          notes.value = res.changes.notes
          documents.value = res.changes.documents
          files.value = res.changes.files
          totpEntries.value = res.changes.totpEntries
          resetting = false
        } else {
          categories.value = upsertById(categories.value, res.changes.categories)
          notes.value = upsertById(notes.value, res.changes.notes)
          documents.value = upsertById(documents.value, res.changes.documents)
          files.value = upsertById(files.value, res.changes.files)
          totpEntries.value = upsertById(totpEntries.value, res.changes.totpEntries)
        }
        since = res.nextSeq
        lastSeq.value = res.nextSeq
        hasMore = res.hasMore
      }
      lastSyncedAt.value = Date.now()
      online.value = true
      await persistToDisk()
    } catch (error) {
      online.value = false
      lastError.value = error instanceof Error ? error.message : "Sync failed"
    } finally {
      syncing.value = false
    }
  }

  async function clearCache() {
    lastSeq.value = 0
    lastSyncedAt.value = null
    categories.value = []
    notes.value = []
    documents.value = []
    files.value = []
    totpEntries.value = []
    await storageRemove(SYNC_CACHE_KEY)
  }

  return {
    lastSeq,
    lastSyncedAt,
    syncing,
    online,
    lastError,
    categories,
    notes,
    documents,
    files,
    totpEntries,
    hydrateFromDisk,
    pull,
    clearCache
  }
})
