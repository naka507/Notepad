import { ROLES, isRole, type CategoryScope, type LinkedAccountSummary, type Role } from "@notepad/core"
import type { CloudflareBindings } from "../env"

export interface UserRow {
  id: string
  username: string | null
  email: string | null
  name: string | null
  avatar_url: string | null
  password_hash: string | null
  password_salt: string | null
  disabled_at: number | null
  created_at: number
  updated_at: number
}

export interface AccountRow {
  id: string
  user_id: string
  provider: string
  provider_user_id: string
  provider_login: string | null
  provider_email: string | null
  created_at: number
}

export interface CategoryRow {
  id: string
  user_id: string
  scope: CategoryScope
  parent_id: string | null
  name: string
  icon: string | null
  color: string | null
  sort_order: number
  version: number
  sync_seq: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface NoteRow {
  id: string
  user_id: string
  category_id: string | null
  title: string
  content: string
  excerpt: string
  is_pinned: number
  is_archived: number
  version: number
  sync_seq: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface FileObjectRow {
  id: string
  user_id: string
  category_id: string | null
  filename: string
  mime_type: string
  size: number
  sha256: string | null
  r2_key: string
  version: number
  sync_seq: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface UploadSessionRow {
  id: string
  user_id: string
  category_id: string | null
  filename: string
  mime_type: string
  declared_size: number
  part_size: number
  r2_key: string
  r2_upload_id: string
  parts_json: string
  status: "uploading" | "completed" | "aborted"
  expires_at: number
  created_at: number
  updated_at: number
}

export interface ShareLinkRow {
  id: string
  share_code: string
  user_id: string
  target_type: "note" | "file" | "document"
  target_id: string
  permission: "view" | "download"
  access_password_hash: string | null
  access_password_salt: string | null
  max_views: number | null
  view_count: number
  expires_at: number | null
  revoked_at: number | null
  created_at: number
}

export interface DocumentRow {
  id: string
  user_id: string
  category_id: string | null
  doc_type: "doc" | "sheet"
  title: string
  excerpt: string
  r2_key: string
  size: number
  is_pinned: number
  is_archived: number
  version: number
  sync_seq: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface TotpEntryRow {
  id: string
  user_id: string
  category_id: string | null
  issuer: string
  account_name: string
  secret_ciphertext: string
  secret_iv: string
  encryption_mode: string
  key_version: number
  algorithm: "SHA1" | "SHA256" | "SHA512"
  digits: number
  period: number
  sort_order: number
  version: number
  sync_seq: number
  deleted_at: number | null
  created_at: number
  updated_at: number
}

export interface DeviceSessionRow {
  id: string
  user_id: string
  device_id: string
  device_name: string
  platform: string
  refresh_token_hash: string
  token_family_id: string
  revoked_at: number | null
  last_seen_at: number
  expires_at: number
  created_at: number
}

export interface WebSessionRow {
  id: string
  user_id: string
  token_hash: string
  user_agent: string | null
  ip_address: string | null
  expires_at: number
  created_at: number
}

export function now(): number {
  return Date.now()
}

export async function getUserById(env: CloudflareBindings, userId: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM user WHERE id = ?").bind(userId).first<UserRow>()
}

export async function getUserRoles(env: CloudflareBindings, userId: string): Promise<Role[]> {
  const result = await env.DB.prepare(
    `SELECT role.name AS role
     FROM user_role
     INNER JOIN role ON role.id = user_role.role_id
     WHERE user_role.user_id = ?`
  )
    .bind(userId)
    .all<{ role: string }>()

  const roles = result.results.map((row) => row.role).filter(isRole)
  return roles.length ? roles : [ROLES.PENDING]
}

export async function getLinkedAccounts(
  env: CloudflareBindings,
  userId: string
): Promise<LinkedAccountSummary[]> {
  const result = await env.DB.prepare(
    `SELECT provider, provider_login, provider_email, created_at
     FROM account
     WHERE user_id = ?
     ORDER BY created_at ASC`
  )
    .bind(userId)
    .all<{
      provider: string
      provider_login: string | null
      provider_email: string | null
      created_at: number
    }>()

  return result.results
    .filter((row): row is typeof row & { provider: "github" } => row.provider === "github")
    .map((row) => ({
      provider: "github",
      providerLogin: row.provider_login,
      providerEmail: row.provider_email,
      linkedAt: row.created_at
    }))
}

export async function assignSingleRole(env: CloudflareBindings, userId: string, role: Role): Promise<void> {
  const roleRow = await env.DB.prepare("SELECT id FROM role WHERE name = ?").bind(role).first<{ id: string }>()
  if (!roleRow) throw new Error(`Role not found: ${role}`)

  const timestamp = now()
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_role WHERE user_id = ?").bind(userId),
    env.DB.prepare("INSERT INTO user_role (user_id, role_id, created_at) VALUES (?, ?, ?)").bind(
      userId,
      roleRow.id,
      timestamp
    )
  ])
}

/**
 * Creates a user and atomically grants ADMIN role if this is the very first user
 * in the system (guarded by SQLite singleton primary key on system_bootstrap).
 * All subsequent users receive PENDING (zero permissions) by default.
 */
export async function createUserWithAtomicBootstrap(
  env: CloudflareBindings,
  values: {
    username: string | null
    email: string | null
    name: string | null
    avatarUrl: string | null
    passwordHash: string | null
    passwordSalt: string | null
  }
): Promise<{ user: UserRow; assignedRole: Role }> {
  const timestamp = now()
  const id = crypto.randomUUID()

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, username, email, name, avatar_url, password_hash, password_salt, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      values.username,
      values.email,
      values.name,
      values.avatarUrl,
      values.passwordHash,
      values.passwordSalt,
      timestamp,
      timestamp
    ),
    env.DB.prepare(
      `INSERT INTO user_sync_state (user_id, current_seq, min_retained_seq, updated_at)
       VALUES (?, 0, 0, ?)`
    ).bind(id, timestamp)
  ])

  const bootstrap = await env.DB.prepare(
    `INSERT OR IGNORE INTO system_bootstrap (singleton_key, admin_user_id, initialized_at)
     VALUES (1, ?, ?)`
  )
    .bind(id, timestamp)
    .run()

  const assignedRole: Role = (bootstrap.meta.changes ?? 0) === 1 ? ROLES.ADMIN : ROLES.PENDING
  await assignSingleRole(env, id, assignedRole)

  const user = await getUserById(env, id)
  if (!user) throw new Error("Created user was not found")

  return { user, assignedRole }
}

export async function nextSyncSeq(env: CloudflareBindings, userId: string): Promise<number> {
  const timestamp = now()
  await env.DB.prepare(
    `INSERT INTO user_sync_state (user_id, current_seq, min_retained_seq, updated_at)
     VALUES (?, 1, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET current_seq = current_seq + 1, updated_at = excluded.updated_at`
  )
    .bind(userId, timestamp)
    .run()

  const row = await env.DB.prepare("SELECT current_seq FROM user_sync_state WHERE user_id = ?")
    .bind(userId)
    .first<{ current_seq: number }>()

  return row?.current_seq ?? 1
}

export async function revokeUserActiveShares(env: CloudflareBindings, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE share_link SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now(), userId)
    .run()
}

export async function revokeTargetActiveShares(
  env: CloudflareBindings,
  targetType: "note" | "file" | "document",
  targetId: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE share_link SET revoked_at = ? WHERE target_type = ? AND target_id = ? AND revoked_at IS NULL"
  )
    .bind(now(), targetType, targetId)
    .run()
}

export function buildDocumentR2Key(userId: string, docId: string): string {
  return `d/${userId}/${docId}.json`
}

export function defaultDocumentContent(docType: "doc" | "sheet"): Record<string, unknown> {
  if (docType === "sheet") {
    return {
      activeSheetId: "sheet_1",
      sheets: [
        {
          id: "sheet_1",
          name: "Sheet1",
          rows: 30,
          cols: 12,
          colWidths: {},
          cells: {}
        }
      ]
    }
  }
  return {
    type: "doc",
    content: [{ type: "paragraph" }]
  }
}

export async function queueR2Deletion(
  env: CloudflareBindings,
  r2Key: string,
  reason: string,
  r2UploadId: string | null = null
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO pending_r2_deletion (id, r2_key, r2_upload_id, reason, attempts, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  )
    .bind(id, r2Key, r2UploadId, reason, now())
    .run()
  return id
}

export async function tryDeleteQueuedR2Object(
  env: CloudflareBindings,
  queueId: string,
  r2Key: string,
  r2UploadId: string | null = null
): Promise<void> {
  try {
    if (r2UploadId) {
      const upload = env.FILES_BUCKET.resumeMultipartUpload(r2Key, r2UploadId)
      await upload.abort()
    } else {
      await env.FILES_BUCKET.delete(r2Key)
    }
    await env.DB.prepare("DELETE FROM pending_r2_deletion WHERE id = ?").bind(queueId).run()
  } catch {
    // Kept in pending_r2_deletion for cleanup Cron retry
  }
}

export function buildNoteExcerpt(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}
