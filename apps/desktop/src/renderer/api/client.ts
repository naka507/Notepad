import {
  SINGLE_UPLOAD_MAX_BYTES,
  type AssignableRole,
  type Category,
  type CategoryScope,
  type CursorPage,
  type DeviceSessionSummary,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
  type FileItem,
  type ManagedUser,
  type NativeAuthTokens,
  type NoteDetail,
  type NoteSummary,
  type ShareLink,
  type ShareTargetType,
  type SiteConfig,
  type StorageStats,
  type SyncPullResponse,
  type SyncPushOperation,
  type SyncPushResponse,
  type TotpAlgorithm,
  type TotpEntry,
  type UserQuotaSummary,
  type UserStorageSummary,
  type UserSummary
} from "@notepad/core"
import { sha256Hex } from "@/utils/format"

export const DEFAULT_SERVER_URL = "https://note.qqx.qzz.io"

const FALLBACK_AUTH_KEY = "notepad_desktop_auth"

export interface DesktopAuthState {
  serverUrl: string
  deviceId: string
  tokens: NativeAuthTokens | null
}

let runtimeState: DesktopAuthState = {
  serverUrl: DEFAULT_SERVER_URL,
  deviceId: crypto.randomUUID(),
  tokens: null
}

let refreshInFlight: Promise<boolean> | null = null
let onSessionExpired: (() => void) | null = null

export function setOnSessionExpired(handler: () => void) {
  onSessionExpired = handler
}

export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/g, "")
  if (!trimmed) return DEFAULT_SERVER_URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
  return `https://${trimmed}`
}

export function getServerUrl(): string {
  return runtimeState.serverUrl
}

export function getDeviceId(): string {
  return runtimeState.deviceId
}

export function getTokens(): NativeAuthTokens | null {
  return runtimeState.tokens
}

export async function loadPersistedDesktopAuth(): Promise<DesktopAuthState> {
  try {
    const loaded = window.notepadDesktop
      ? await window.notepadDesktop.loadAuthState()
      : (JSON.parse(localStorage.getItem(FALLBACK_AUTH_KEY) || "null") as DesktopAuthState | null)
    if (loaded && typeof loaded.serverUrl === "string") {
      runtimeState = {
        serverUrl: normalizeServerUrl(loaded.serverUrl),
        deviceId: loaded.deviceId || crypto.randomUUID(),
        tokens: loaded.tokens ?? null
      }
      return runtimeState
    }
  } catch {
    // fallback to default state
  }
  return runtimeState
}

export async function savePersistedDesktopAuth(patch: Partial<DesktopAuthState>): Promise<void> {
  runtimeState = {
    ...runtimeState,
    ...patch,
    ...(patch.serverUrl ? { serverUrl: normalizeServerUrl(patch.serverUrl) } : {})
  }
  if (window.notepadDesktop) {
    await window.notepadDesktop.saveAuthState(runtimeState)
  } else {
    localStorage.setItem(FALLBACK_AUTH_KEY, JSON.stringify(runtimeState))
  }
}

export async function clearPersistedDesktopTokens(): Promise<void> {
  await savePersistedDesktopAuth({ tokens: null })
}

export class ApiError extends Error {
  status: number
  code?: string
  data?: unknown

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message)
    this.status = status
    if (code !== undefined) this.code = code
    if (data !== undefined) this.data = data
  }
}

async function refreshTokensIfPossible(): Promise<boolean> {
  if (!runtimeState.tokens?.refreshToken) return false
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${runtimeState.serverUrl}/api/auth/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: runtimeState.tokens!.refreshToken })
      })
      if (!response.ok) {
        await clearPersistedDesktopTokens()
        onSessionExpired?.()
        return false
      }
      const data = (await response.json()) as { user: UserSummary; tokens: NativeAuthTokens }
      await savePersistedDesktopAuth({ tokens: data.tokens })
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function rawAuthorizedFetch(path: string, init: RequestInit = {}, retryOn401 = true): Promise<Response> {
  if (runtimeState.tokens && runtimeState.tokens.accessExpiresAt - Date.now() < 60_000) {
    await refreshTokensIfPossible()
  }

  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }
  if (runtimeState.tokens?.accessToken) {
    headers.set("Authorization", `Bearer ${runtimeState.tokens.accessToken}`)
  }

  const response = await fetch(`${runtimeState.serverUrl}${path}`, {
    ...init,
    headers
  })

  if (response.status === 401 && retryOn401 && runtimeState.tokens?.refreshToken) {
    const refreshed = await refreshTokensIfPossible()
    if (refreshed) {
      return rawAuthorizedFetch(path, init, false)
    }
  }

  return response
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await rawAuthorizedFetch(path, init)
  const contentType = response.headers.get("Content-Type") || ""
  const data = contentType.includes("application/json") ? ((await response.json()) as Record<string, unknown>) : null

  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : `Request failed (${response.status})`
    const code = data && typeof data.code === "string" ? data.code : undefined
    throw new ApiError(message, response.status, code, data)
  }

  return data as T
}

async function getDeviceMeta(): Promise<{ deviceId: string; deviceName: string; platform: string }> {
  const info = await window.notepadDesktop?.getInfo().catch(() => null)
  const platform =
    info?.platform === "darwin" ? "macos" : info?.platform === "linux" ? "linux" : "windows"
  const deviceName = info?.hostname ? `${info.hostname} (Desktop)` : "Notepad Desktop"
  return {
    deviceId: runtimeState.deviceId,
    deviceName,
    platform
  }
}

export const api = {
  get serverUrl() {
    return runtimeState.serverUrl
  },
  get githubLoginUrl() {
    return `${runtimeState.serverUrl}/api/auth/github/start?client=desktop`
  },
  get githubBindUrl() {
    return `${runtimeState.serverUrl}/profile`
  },

  session: () => request<{ user: UserSummary | null }>("/api/session"),
  async login(payload: { username: string; password: string; turnstileToken?: string }) {
    const meta = await getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens?: NativeAuthTokens }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        client: "desktop",
        ...meta
      })
    })
    if (res.tokens) {
      await savePersistedDesktopAuth({ tokens: res.tokens })
    }
    return res
  },
  async register(payload: { username: string; password: string; turnstileToken?: string }) {
    const meta = await getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens?: NativeAuthTokens }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        client: "desktop",
        ...meta
      })
    })
    if (res.tokens) {
      await savePersistedDesktopAuth({ tokens: res.tokens })
    }
    return res
  },
  async exchangeOAuthCode(code: string) {
    const meta = await getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens: NativeAuthTokens }>("/api/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, ...meta })
    })
    await savePersistedDesktopAuth({ tokens: res.tokens })
    return res
  },
  async logout() {
    try {
      await request<{ success: true }>("/api/auth/logout", { method: "POST" })
    } catch {
      // ignore network failure during local sign-out
    } finally {
      await clearPersistedDesktopTokens()
    }
    return { success: true as const }
  },
  unbindGithub: () => request<{ success: true }>("/api/auth/github/bind", { method: "DELETE" }),
  setPassword: (payload: { password: string; username?: string }) =>
    request<{ success: true }>("/api/auth/password/set", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  changePassword: (payload: { currentPassword: string; newPassword: string }) =>
    request<{ success: true }>("/api/auth/password/change", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listDevices: () => request<{ devices: DeviceSessionSummary[] }>("/api/auth/devices"),
  revokeDevice: (id: string) => request<{ success: true }>(`/api/auth/devices/${id}`, { method: "DELETE" }),

  config: () => request<SiteConfig>("/api/config"),
  updateConfig: (payload: SiteConfig) =>
    request<{ success: true }>("/api/config", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),

  listCategories: (scope?: CategoryScope) =>
    request<{ categories: Category[]; defaultCount: number }>(
      `/api/categories${scope ? `?scope=${encodeURIComponent(scope)}` : ""}`
    ),
  createCategory: (payload: { scope: CategoryScope; name: string; color?: string | null }) =>
    request<{ category: Category }>("/api/categories", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateCategory: (id: string, payload: { name?: string; color?: string | null; sortOrder?: number }) =>
    request<{ category: Category }>(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteCategory: (id: string) => request<{ success: true }>(`/api/categories/${id}`, { method: "DELETE" }),

  listNotes: (params: { view?: "active" | "archived" | "trash"; categoryId?: string; q?: string; cursor?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.view) query.set("view", params.view)
    if (params.categoryId) query.set("categoryId", params.categoryId)
    if (params.q) query.set("q", params.q)
    if (params.cursor) query.set("cursor", params.cursor)
    const qs = query.toString()
    return request<CursorPage<NoteSummary>>(`/api/notes${qs ? `?${qs}` : ""}`)
  },
  getNote: (id: string) => request<{ note: NoteDetail }>(`/api/notes/${id}`),
  createNote: (payload: { title?: string; content?: string; categoryId?: string | null; isPinned?: boolean }) =>
    request<{ note: NoteDetail }>("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateNote: (
    id: string,
    payload: {
      title?: string
      content?: string
      categoryId?: string | null
      isPinned?: boolean
      isArchived?: boolean
      baseVersion?: number
    }
  ) =>
    request<{ note: NoteDetail }>(`/api/notes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteNote: (id: string) => request<{ success: true }>(`/api/notes/${id}`, { method: "DELETE" }),
  restoreNote: (id: string) => request<{ success: true }>(`/api/notes/${id}/restore`, { method: "POST" }),
  permanentDeleteNote: (id: string) =>
    request<{ success: true }>(`/api/notes/${id}/permanent`, { method: "DELETE" }),

  listDocuments: (
    params: {
      view?: "active" | "archived" | "trash"
      docType?: DocumentType
      categoryId?: string
      q?: string
      cursor?: string
    } = {}
  ) => {
    const query = new URLSearchParams()
    if (params.view) query.set("view", params.view)
    if (params.docType) query.set("docType", params.docType)
    if (params.categoryId) query.set("categoryId", params.categoryId)
    if (params.q) query.set("q", params.q)
    if (params.cursor) query.set("cursor", params.cursor)
    const qs = query.toString()
    return request<CursorPage<DocumentSummary>>(`/api/documents${qs ? `?${qs}` : ""}`)
  },
  getDocument: (id: string) => request<{ document: DocumentDetail }>(`/api/documents/${id}`),
  createDocument: (payload: {
    docType: DocumentType
    title?: string
    content?: Record<string, unknown>
    excerpt?: string
    categoryId?: string | null
    isPinned?: boolean
  }) =>
    request<{ document: DocumentDetail }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateDocument: (
    id: string,
    payload: {
      title?: string
      content?: Record<string, unknown>
      excerpt?: string
      categoryId?: string | null
      isPinned?: boolean
      isArchived?: boolean
      baseVersion?: number
    }
  ) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteDocument: (id: string) =>
    request<{ success: true }>(`/api/documents/${id}`, { method: "DELETE" }),
  restoreDocument: (id: string) =>
    request<{ success: true }>(`/api/documents/${id}/restore`, { method: "POST" }),
  permanentDeleteDocument: (id: string) =>
    request<{ success: true }>(`/api/documents/${id}/permanent`, { method: "DELETE" }),

  listFiles: (params: { categoryId?: string; q?: string; cursor?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.categoryId) query.set("categoryId", params.categoryId)
    if (params.q) query.set("q", params.q)
    if (params.cursor) query.set("cursor", params.cursor)
    const qs = query.toString()
    return request<CursorPage<FileItem> & { quota: UserQuotaSummary }>(`/api/files${qs ? `?${qs}` : ""}`)
  },
  updateFile: (id: string, payload: { filename?: string; categoryId?: string | null }) =>
    request<{ file: FileItem }>(`/api/files/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteFile: (id: string) => request<{ success: true }>(`/api/files/${id}`, { method: "DELETE" }),
  fileContentUrl: (id: string, download = false) =>
    `${runtimeState.serverUrl}/api/files/${id}/content${download ? "?download=1" : ""}`,
  async fetchFileBlob(id: string, download = false): Promise<Blob> {
    const res = await rawAuthorizedFetch(`/api/files/${id}/content${download ? "?download=1" : ""}`)
    if (!res.ok) throw new ApiError(`Failed to fetch file (${res.status})`, res.status)
    return res.blob()
  },

  async uploadFile(
    file: File,
    options: {
      categoryId?: string | null
      onProgress?: (percent: number) => void
    } = {}
  ): Promise<FileItem> {
    const onProgress = options.onProgress ?? (() => {})
    const mimeType = file.type || "application/octet-stream"

    if (file.size <= SINGLE_UPLOAD_MAX_BYTES) {
      onProgress(10)
      const sha256 = await sha256Hex(file)
      onProgress(35)
      const headers = new Headers({
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Mime": mimeType,
        "X-File-Size": String(file.size)
      })
      if (options.categoryId) headers.set("X-File-Category", options.categoryId)
      if (sha256) headers.set("X-File-Sha256", sha256)

      const result = await request<{ file: FileItem }>("/api/files/upload", {
        method: "POST",
        headers,
        body: file
      })
      onProgress(100)
      return result.file
    }

    onProgress(2)
    const init = await request<{ uploadSessionId: string; partSize: number; totalParts: number }>(
      "/api/files/multipart/init",
      {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType,
          size: file.size,
          ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {})
        })
      }
    )

    const uploadedParts: Array<{ partNumber: number; etag: string }> = []
    try {
      for (let index = 0; index < init.totalParts; index += 1) {
        const partNumber = index + 1
        const start = index * init.partSize
        const end = Math.min(start + init.partSize, file.size)
        const chunk = file.slice(start, end)

        const partRes = await request<{ partNumber: number; etag: string }>(
          `/api/files/multipart/${init.uploadSessionId}/parts/${partNumber}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk
          }
        )
        uploadedParts.push(partRes)
        onProgress(Math.min(95, Math.round((partNumber / init.totalParts) * 90) + 5))
      }

      const complete = await request<{ file: FileItem }>(
        `/api/files/multipart/${init.uploadSessionId}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ parts: uploadedParts })
        }
      )
      onProgress(100)
      return complete.file
    } catch (error) {
      await rawAuthorizedFetch(`/api/files/multipart/${init.uploadSessionId}`, { method: "DELETE" }).catch(() => {})
      throw error
    }
  },

  listShares: () => request<{ shares: ShareLink[] }>("/api/shares"),
  createShare: (payload: {
    targetType: ShareTargetType
    targetId: string
    ttlSec?: number
    permission?: "view" | "download"
    accessPassword?: string
    maxViews?: number | null
  }) =>
    request<{ share: ShareLink }>("/api/shares", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  revokeShare: (id: string) => request<{ success: true }>(`/api/shares/${id}`, { method: "DELETE" }),

  syncCursor: () => request<{ currentSeq: number; minRetainedSeq: number; serverTime: number }>("/api/sync/cursor"),
  syncPull: (sinceSeq = 0, limit = 150) =>
    request<SyncPullResponse>(`/api/sync/pull?sinceSeq=${sinceSeq}&limit=${limit}`),
  syncPush: (operations: SyncPushOperation[]) =>
    request<SyncPushResponse>("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({ operations })
    }),

  listTotp: (params: { view?: "archived" | "trash"; categoryId?: string; q?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.view) query.set("view", params.view)
    if (params.categoryId) query.set("categoryId", params.categoryId)
    if (params.q) query.set("q", params.q)
    const qs = query.toString()
    return request<{ items: TotpEntry[]; total: number }>(`/api/totp${qs ? `?${qs}` : ""}`)
  },
  createTotp: (payload: {
    issuer?: string
    accountName: string
    secret: string
    algorithm?: TotpAlgorithm
    digits?: 6 | 8
    period?: number
    categoryId?: string | null
  }) =>
    request<{ entry: TotpEntry }>("/api/totp", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  importTotp: (payload: { uris: string[]; categoryId?: string | null }) =>
    request<{ imported: TotpEntry[]; skipped: number }>("/api/totp/import", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateTotp: (
    id: string,
    payload: { issuer?: string; accountName?: string; categoryId?: string | null; baseVersion?: number }
  ) =>
    request<{ entry: TotpEntry }>(`/api/totp/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteTotp: (id: string) => request<{ success: true }>(`/api/totp/${id}`, { method: "DELETE" }),
  restoreTotp: (id: string) => request<{ success: true }>(`/api/totp/${id}/restore`, { method: "POST" }),
  permanentDeleteTotp: (id: string) =>
    request<{ success: true }>(`/api/totp/${id}/permanent`, { method: "DELETE" }),

  listUsers: () => request<{ users: ManagedUser[] }>("/api/admin/users"),
  storageStats: () => request<{ stats: StorageStats }>("/api/admin/storage-stats"),
  userStorageSummary: () => request<{ summary: UserStorageSummary }>("/api/storage/summary"),
  updateUserRole: (userId: string, role: AssignableRole) =>
    request<{ success: true }>(`/api/admin/users/${userId}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    }),
  updateUserStatus: (userId: string, disabled: boolean) =>
    request<{ success: true }>(`/api/admin/users/${userId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ disabled })
    }),
  deleteUser: (userId: string) =>
    request<{ success: true }>(`/api/admin/users/${userId}`, { method: "DELETE" })
}
