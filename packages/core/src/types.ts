import type { Permission, Role } from "./permissions"

export interface LinkedAccountSummary {
  provider: "github"
  providerLogin: string | null
  providerEmail: string | null
  linkedAt: number
}

export interface UserQuotaSummary {
  maxFileSize: number | null
  maxFileCount: number | null
  unlimited: boolean
  usedFileCount: number
  usedBytes: number
  lockedFileCount: number
}

export interface UserSummary {
  id: string
  username: string | null
  email: string | null
  name: string | null
  avatarUrl: string | null
  role: Role
  roles: Role[]
  permissions: Permission[]
  hasPassword: boolean
  linkedAccounts: LinkedAccountSummary[]
  quota: UserQuotaSummary
}

export interface SiteConfig {
  adminContact: string
  turnstile: {
    enabled: boolean
    siteKey: string
    secretKey?: string
  }
  github: {
    enabled: boolean
    clientId: string
    clientSecret?: string
    clientSecretConfigured?: boolean
  }
  share: {
    defaultTtlSec: number
    memberAllowedTtlSec: number[]
    memberMaxTtlSec: number
  }
  storageGuardrail: {
    softWarnBytes: number
    hardLimitBytes: number
    hardLimitEnabled: boolean
  }
}

export type CategoryScope = "note" | "document" | "sheet" | "file"

export interface Category {
  id: string
  scope: CategoryScope
  parentId: string | null
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  itemCount?: number
  noteCount?: number
  docCount?: number
  sheetCount?: number
  fileCount?: number
  version: number
  createdAt: number
  updatedAt: number
}

export type DocumentType = "doc" | "sheet"

export interface SheetCell {
  v: string
  bold?: boolean
  align?: "left" | "center" | "right"
  bg?: string
}

export interface SheetTab {
  id: string
  name: string
  rows: number
  cols: number
  colWidths: Record<string, number>
  cells: Record<string, SheetCell>
}

export interface SheetWorkbook {
  activeSheetId: string
  sheets: SheetTab[]
}

export interface DocumentSummary {
  id: string
  categoryId: string | null
  docType: DocumentType
  title: string
  excerpt: string
  size: number
  isPinned: boolean
  isArchived: boolean
  version: number
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface DocumentDetail extends DocumentSummary {
  content: Record<string, unknown>
}

export interface NoteSummary {
  id: string
  categoryId: string | null
  title: string
  excerpt: string
  isPinned: boolean
  isArchived: boolean
  version: number
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface NoteDetail extends NoteSummary {
  content: string
}

export type FileAccessStatus = "active" | "locked_size" | "locked_quota" | "locked_role"

export interface FileItem {
  id: string
  categoryId: string | null
  filename: string
  mimeType: string
  size: number
  sha256: string | null
  accessStatus: FileAccessStatus
  version: number
  deletedAt: number | null
  createdAt: number
  updatedAt: number
}

export type ShareTargetType = "note" | "file" | "document"

export interface ShareLink {
  id: string
  shareCode: string
  targetType: ShareTargetType
  targetId: string
  targetTitle: string
  targetDocType?: DocumentType | null
  targetSize: number | null
  targetMimeType: string | null
  permission: "view" | "download"
  hasPassword: boolean
  maxViews: number | null
  viewCount: number
  expiresAt: number | null
  revokedAt: number | null
  isActive: boolean
  createdAt: number
}

export interface PublicSharePayload {
  shareCode: string
  targetType: ShareTargetType
  permission: "view" | "download"
  requiresPassword: boolean
  expiresAt: number | null
  viewCount: number
  maxViews: number | null
  note?: {
    title: string
    content: string
    updatedAt: number
  }
  document?: {
    title: string
    docType: DocumentType
    content: Record<string, unknown>
    updatedAt: number
  }
  file?: {
    filename: string
    mimeType: string
    size: number
    updatedAt: number
    previewable: boolean
  }
}

export interface ManagedUser {
  id: string
  username: string | null
  email: string | null
  name: string | null
  avatarUrl: string | null
  role: Role
  roles: Role[]
  hasPassword: boolean
  hasGithub: boolean
  fileCount: number
  storageBytes: number
  noteCount: number
  disabledAt: number | null
  createdAt: number
}

export interface StorageStats {
  totalBytes: number
  totalFiles: number
  totalNotes: number
  totalUsers: number
  activeShares: number
  freeTierLimitBytes: number
  softWarnBytes: number
  hardLimitBytes: number
  hardLimitEnabled: boolean
}

export interface UserStorageSummary {
  usedBytes: number
  usedFileCount: number
  maxFileCount: number | null
  remainingFileCount: number | null
  maxFileSize: number | null
  lockedFileCount: number
  containerAvailableBytes: number
  containerLimitBytes: number
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  total: number
}
