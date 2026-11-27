import {
  SINGLE_UPLOAD_MAX_BYTES,
  type Category,
  type CategoryScope,
  type CursorPage,
  type DeviceSessionSummary,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
  type FileItem,
  type NativeAuthTokens,
  type NoteDetail,
  type NoteSummary,
  type ShareLink,
  type ShareTargetType,
  type SiteConfig,
  type SyncPullResponse,
  type SyncPushOperation,
  type SyncPushResponse,
  type TotpAlgorithm,
  type TotpEntry,
  type UserQuotaSummary,
  type UserStorageSummary,
  type UserSummary
} from "@notepad/core"
import { getMobilePlatform, storageGet, storageSet } from "@/native/bridge"
import { sha256Hex } from "@/utils/format"

export const DEFAULT_SERVER_URL = "https://note.qqx.qzz.io"
const AUTH_STORAGE_KEY = "notepad_mobile_auth_v1"

export interface MobileAuthState {
  serverUrl: string
  deviceId: string
  tokens: NativeAuthTokens | null
}

let runtimeState: MobileAuthState = {
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

export function getTokens(): NativeAuthTokens | null {
  return runtimeState.tokens
}

export async function loadPersistedMobileAuth(): Promise<MobileAuthState> {
  try {
    const raw = await storageGet(AUTH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MobileAuthState>
      runtimeState = {
        serverUrl: normalizeServerUrl(parsed.serverUrl || DEFAULT_SERVER_URL),
        deviceId: parsed.deviceId || crypto.randomUUID(),
        tokens: parsed.tokens ?? null
      }
      return runtimeState
    }
  } catch {
    // ignore corrupted cache
  }
  return runtimeState
}

export async function savePersistedMobileAuth(patch: Partial<MobileAuthState>): Promise<void> {
  runtimeState = {
    ...runtimeState,
    ...patch,
    ...(patch.serverUrl ? { serverUrl: normalizeServerUrl(patch.serverUrl) } : {})
  }
  await storageSet(AUTH_STORAGE_KEY, JSON.stringify(runtimeState))
}

export async function clearPersistedMobileTokens(): Promise<void> {
  await savePersistedMobileAuth({ tokens: null })
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

function getDeviceMeta() {
  const platform = getMobilePlatform()
  const deviceName =
    platform === "ios"
      ? "Notepad iOS"
      : platform === "android"
        ? "Notepad Android"
        : "Notepad Mobile"
  return {
    deviceId: runtimeState.deviceId,
    deviceName,
    platform
  }
}

async function refreshAccessToken(): Promise<boolean> {
  if (!runtimeState.tokens?.refreshToken) return false
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${runtimeState.serverUrl}/api/auth/token/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: runtimeState.tokens?.refreshToken })
      })
      if (!res.ok) {
        await clearPersistedMobileTokens()
        onSessionExpired?.()
        return false
      }
      const data = (await res.json()) as { tokens: NativeAuthTokens }
      await savePersistedMobileAuth({ tokens: data.tokens })
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

async function ensureFreshToken(): Promise<string | null> {
  const tokens = runtimeState.tokens
  if (!tokens) return null
  const nowSec = Math.floor(Date.now() / 1000)
  if (tokens.accessExpiresAt - nowSec < 60) {
    await refreshAccessToken()
  }
  return runtimeState.tokens?.accessToken ?? null
}

async function rawFetch(path: string, init?: RequestInit, allowRetry = true): Promise<Response> {
  const token = await ensureFreshToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set("Authorization", `Bearer ${token}`)
  }
  const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${runtimeState.serverUrl}${path}`
  const response = await fetch(url, { ...init, headers })

  if (response.status === 401 && allowRetry && runtimeState.tokens?.refreshToken) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      return rawFetch(path, init, false)
    }
  }
  return response
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!(init?.body instanceof FormData) && !(init?.body instanceof Blob) && !(init?.body instanceof ArrayBuffer)) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json")
    }
  }

  const response = await rawFetch(path, { ...init, headers })
  const contentType = response.headers.get("Content-Type") ?? ""
  const data = contentType.includes("application/json") ? await response.json() : await response.text()

  if (!response.ok) {
    const payload = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : `Request failed (${response.status})`,
      response.status,
      typeof payload.code === "string" ? payload.code : undefined,
      data
    )
  }
  return data as T
}

export const api = {
  get serverUrl() {
    return runtimeState.serverUrl
  },
  get githubLoginUrl() {
    return `${runtimeState.serverUrl}/api/auth/github/start?client=mobile`
  },
  get githubBindUrl() {
    return `${runtimeState.serverUrl}/profile`
  },

  session: () => request<{ user: UserSummary | null }>("/api/session"),
  async login(payload: { username: string; password: string; turnstileToken?: string }) {
    const meta = getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens?: NativeAuthTokens }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ ...payload, client: "mobile", ...meta })
    })
    if (res.tokens) await savePersistedMobileAuth({ tokens: res.tokens })
    return res
  },
  async register(payload: { username: string; password: string; turnstileToken?: string }) {
    const meta = getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens?: NativeAuthTokens }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...payload, client: "mobile", ...meta })
    })
    if (res.tokens) await savePersistedMobileAuth({ tokens: res.tokens })
    return res
  },
  async exchangeOAuthCode(code: string) {
    const meta = getDeviceMeta()
    const res = await request<{ user: UserSummary; tokens: NativeAuthTokens }>("/api/auth/oauth/exchange", {
      method: "POST",
      body: JSON.stringify({ code, ...meta })
    })
    await savePersistedMobileAuth({ tokens: res.tokens })
    return res
  },
  async logout() {
    try {
      await request<{ success: true }>("/api/auth/logout", { method: "POST" })
    } catch {
      // ignore offline sign-out error
    } finally {
      await clearPersistedMobileTokens()
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

  listDocuments: (params: {
    docType?: DocumentType
    view?: "active" | "archived" | "trash"
    categoryId?: string
    q?: string
    cursor?: string
  } = {}) => {
    const query = new URLSearchParams()
    if (params.docType) query.set("docType", params.docType)
    if (params.view) query.set("view", params.view)
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
    categoryId?: string | null
    content?: unknown
  }) =>
    request<{ document: DocumentDetail }>("/api/documents", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateDocument: (
    id: string,
    payload: {
      title?: string
      categoryId?: string | null
      isPinned?: boolean
      isArchived?: boolean
      content?: Record<string, unknown>
      excerpt?: string
      baseVersion?: number
    }
  ) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteDocument: (id: string) => request<{ success: true }>(`/api/documents/${id}`, { method: "DELETE" }),
  restoreDocument: (id: string) => request<{ success: true }>(`/api/documents/${id}/restore`, { method: "POST" }),
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
  async fetchFileBlob(id: string): Promise<Blob> {
    const response = await rawFetch(`/api/files/${id}/content?inline=1`)
    if (!response.ok) {
      throw new ApiError(`Failed to load file (${response.status})`, response.status)
    }
    return response.blob()
  },

  async uploadFile(
    file: File,
    categoryId: string | null,
    onProgress?: (percent: number) => void
  ): Promise<FileItem> {
    const sha256 = await sha256Hex(file)
    if (file.size <= SINGLE_UPLOAD_MAX_BYTES) {
      onProgress?.(20)
      const headers: Record<string, string> = {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Mime": file.type || "application/octet-stream",
        "X-File-Size": String(file.size)
      }
      if (sha256) headers["X-File-Sha256"] = sha256
      if (categoryId) headers["X-File-Category"] = categoryId
      const res = await request<{ file: FileItem }>("/api/files/upload", {
        method: "POST",
        headers,
        body: file
      })
      onProgress?.(100)
      return res.file
    }

    const init = await request<{ sessionId: string; partSize: number }>("/api/files/multipart/init", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        categoryId
      })
    })

    const parts: Array<{ partNumber: number; etag: string }> = []
    const totalParts = Math.ceil(file.size / init.partSize)
    try {
      for (let i = 0; i < totalParts; i++) {
        const partNumber = i + 1
        const chunk = file.slice(i * init.partSize, Math.min(file.size, partNumber * init.partSize))
        const uploaded = await request<{ partNumber: number; etag: string }>(
          `/api/files/multipart/${init.sessionId}/parts/${partNumber}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk
          }
        )
        parts.push(uploaded)
        onProgress?.(Math.min(95, Math.round((partNumber / totalParts) * 95)))
      }

      const completed = await request<{ file: FileItem }>(
        `/api/files/multipart/${init.sessionId}/complete`,
        {
          method: "POST",
          body: JSON.stringify({ parts, sha256 })
        }
      )
      onProgress?.(100)
      return completed.file
    } catch (error) {
      await request(`/api/files/multipart/${init.sessionId}`, { method: "DELETE" }).catch(() => undefined)
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
    maxViews?: number
  }) =>
    request<{ share: ShareLink }>("/api/shares", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  revokeShare: (id: string) => request<{ success: true }>(`/api/shares/${id}`, { method: "DELETE" }),

  syncCursor: () => request<{ currentSeq: number; serverTime: number }>("/api/sync/cursor"),
  syncPull: (since = 0, limit = 100) =>
    request<SyncPullResponse>(`/api/sync/pull?since=${encodeURIComponent(String(since))}&limit=${limit}`),
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

  userStorageSummary: () => request<{ summary: UserStorageSummary }>("/api/storage/summary")
}
