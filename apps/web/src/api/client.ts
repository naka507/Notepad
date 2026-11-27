import {
  SINGLE_UPLOAD_MAX_BYTES,
  type AssignableRole,
  type Category,
  type CategoryScope,
  type CursorPage,
  type DocumentDetail,
  type DocumentSummary,
  type DocumentType,
  type FileItem,
  type ManagedUser,
  type NoteDetail,
  type NoteSummary,
  type PublicSharePayload,
  type ShareLink,
  type ShareTargetType,
  type SiteConfig,
  type StorageStats,
  type UserQuotaSummary,
  type UserStorageSummary,
  type UserSummary
} from "@notepad/core"
import { sha256Hex } from "@/utils/format"

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

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof Blob) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers
  })

  const contentType = response.headers.get("Content-Type") || ""
  const data = contentType.includes("application/json") ? ((await response.json()) as Record<string, unknown>) : null

  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : `Request failed (${response.status})`
    const code = data && typeof data.code === "string" ? data.code : undefined
    throw new ApiError(message, response.status, code, data)
  }

  return data as T
}

export const api = {
  session: () => request<{ user: UserSummary | null }>("/api/session"),
  login: (payload: { username: string; password: string; turnstileToken?: string }) =>
    request<{ user: UserSummary }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  register: (payload: { username: string; password: string; turnstileToken?: string }) =>
    request<{ user: UserSummary }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logout: () => request<{ success: true }>("/api/auth/logout", { method: "POST" }),
  githubLoginUrl: "/api/auth/github/start",
  githubBindUrl: "/api/auth/github/bind/start",
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
    `/api/files/${id}/content${download ? "?download=1" : ""}`,

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

    // Multipart upload for > 5MB (5MB chunks for <=50MB, 20MB chunks for admin >50MB)
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
      await fetch(`/api/files/multipart/${init.uploadSessionId}`, {
        method: "DELETE",
        credentials: "include"
      }).catch(() => {})
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

  getPublicShare: (code: string) => request<{ share: PublicSharePayload }>(`/api/public/shares/${code}`),
  verifyPublicShare: (code: string, password: string) =>
    request<{ success: true }>(`/api/public/shares/${code}/verify`, {
      method: "POST",
      body: JSON.stringify({ password })
    }),
  publicShareDownloadUrl: (code: string, inline = false) =>
    `/api/public/shares/${code}/download${inline ? "?inline=1" : ""}`,

  syncCursor: () => request<{ currentSeq: number; serverTime: number }>("/api/sync/cursor"),

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
