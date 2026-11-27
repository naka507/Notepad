import { MB } from "./permissions"

export const SESSION_COOKIE_NAME = "notepad_session"
export const OAUTH_STATE_COOKIE_NAME = "notepad_oauth_state"
export const SITE_CONFIG_KV_KEY = "site_config_v1"

export const SINGLE_UPLOAD_MAX_BYTES = 5 * MB
export const MULTIPART_DEFAULT_PART_SIZE = 5 * MB
export const MULTIPART_LARGE_PART_SIZE = 20 * MB
export const MULTIPART_LARGE_FILE_THRESHOLD = 50 * MB
export const UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000

export const DEFAULT_SHARE_TTL_SEC = 3600
export const DEFAULT_MEMBER_ALLOWED_SHARE_TTL_SEC = [900, 3600, 21600, 86400] as const
export const DEFAULT_MEMBER_MAX_SHARE_TTL_SEC = 86400
export const ADMIN_SHARE_TTL_PRESETS_SEC = [900, 3600, 21600, 86400, 604800, 2592000, 0] as const

export const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024
export const DEFAULT_R2_SOFT_WARN_BYTES = Math.floor(9.0 * 1024 * 1024 * 1024)
export const DEFAULT_R2_HARD_LIMIT_BYTES = Math.floor(9.8 * 1024 * 1024 * 1024)

export const NOTE_PAGE_SIZE = 50
export const DOCUMENT_PAGE_SIZE = 50
export const DOCUMENT_MAX_BODY_BYTES = 5 * MB
export const FILE_PAGE_SIZE = 50
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function partSizeForFileSize(fileSize: number): number {
  if (fileSize > MULTIPART_LARGE_FILE_THRESHOLD) {
    return MULTIPART_LARGE_PART_SIZE
  }
  return MULTIPART_DEFAULT_PART_SIZE
}
