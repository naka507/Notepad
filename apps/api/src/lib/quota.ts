import {
  PERMISSIONS,
  hasPermission,
  quotaForRoles,
  type FileAccessStatus,
  type Role,
  type SiteConfig,
  type UserQuotaSummary
} from "@notepad/core"
import { HTTPException } from "hono/http-exception"
import type { CloudflareBindings } from "../env"
import { now } from "./db"

export interface FileAccessSnapshot {
  statusById: Map<string, FileAccessStatus>
  quota: UserQuotaSummary
}

/**
 * Computes real-time per-file access status based on current user roles.
 * Ensures admin downgrades take effect immediately:
 * - Data & files remain preserved in D1/R2
 * - Files exceeding current role maxFileSize or maxFileCount (after earliest N eligible files)
 *   are marked locked and cannot be previewed or downloaded until upgraded or excess files deleted.
 */
export async function computeFileAccessSnapshot(
  env: CloudflareBindings,
  userId: string,
  roles: Role[]
): Promise<FileAccessSnapshot> {
  const roleQuota = quotaForRoles(roles)
  const canManageFiles = hasPermission(roles, PERMISSIONS.FILE_MANAGE)

  const rows = await env.DB.prepare(
    `SELECT id, size
     FROM file_object
     WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC`
  )
    .bind(userId)
    .all<{ id: string; size: number }>()

  const statusById = new Map<string, FileAccessStatus>()
  let usedBytes = 0
  let lockedFileCount = 0
  let eligibleActiveCount = 0

  for (const row of rows.results) {
    usedBytes += row.size

    if (!canManageFiles) {
      statusById.set(row.id, "locked_role")
      lockedFileCount += 1
      continue
    }

    if (roleQuota.unlimited) {
      statusById.set(row.id, "active")
      continue
    }

    if (roleQuota.maxFileSize !== null && row.size > roleQuota.maxFileSize) {
      statusById.set(row.id, "locked_size")
      lockedFileCount += 1
      continue
    }

    if (roleQuota.maxFileCount !== null && eligibleActiveCount >= roleQuota.maxFileCount) {
      statusById.set(row.id, "locked_quota")
      lockedFileCount += 1
      continue
    }

    eligibleActiveCount += 1
    statusById.set(row.id, "active")
  }

  return {
    statusById,
    quota: {
      maxFileSize: roleQuota.maxFileSize,
      maxFileCount: roleQuota.maxFileCount,
      unlimited: roleQuota.unlimited,
      usedFileCount: rows.results.length,
      usedBytes,
      lockedFileCount
    }
  }
}

export async function getTotalGlobalR2Bytes(env: CloudflareBindings, timestamp = now()): Promise<number> {
  const [storedFiles, storedDocs, uploadingFiles] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM file_object WHERE deleted_at IS NULL").first<{
      bytes: number
    }>(),
    env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS bytes FROM document WHERE deleted_at IS NULL").first<{
      bytes: number
    }>(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(declared_size), 0) AS bytes FROM file_upload_session WHERE status = 'uploading' AND expires_at > ?"
    )
      .bind(timestamp)
      .first<{ bytes: number }>()
  ])

  return (storedFiles?.bytes ?? 0) + (storedDocs?.bytes ?? 0) + (uploadingFiles?.bytes ?? 0)
}

export async function assertGlobalR2Guardrail(
  env: CloudflareBindings,
  deltaBytes: number,
  siteConfig: SiteConfig
): Promise<void> {
  if (!siteConfig.storageGuardrail.hardLimitEnabled || deltaBytes <= 0) return
  const currentTotal = await getTotalGlobalR2Bytes(env)
  if (currentTotal + deltaBytes > siteConfig.storageGuardrail.hardLimitBytes) {
    throw new HTTPException(507, {
      message: "Storage capacity reached Cloudflare free-tier guardrail"
    })
  }
}

export async function assertUploadAllowed(
  env: CloudflareBindings,
  userId: string,
  roles: Role[],
  declaredSize: number,
  siteConfig: SiteConfig
): Promise<void> {
  if (!hasPermission(roles, PERMISSIONS.FILE_MANAGE)) {
    throw new HTTPException(403, { message: "No file upload permission" })
  }

  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    throw new HTTPException(400, { message: "Invalid file size" })
  }

  const roleQuota = quotaForRoles(roles)
  const timestamp = now()

  if (!roleQuota.unlimited) {
    if (roleQuota.maxFileSize !== null && declaredSize > roleQuota.maxFileSize) {
      const limitMb = Math.round(roleQuota.maxFileSize / (1024 * 1024))
      throw new HTTPException(413, { message: `File exceeds role size limit (${limitMb} MB)` })
    }

    if (roleQuota.maxFileCount !== null) {
      const [fileCountRow, uploadCountRow] = await Promise.all([
        env.DB.prepare("SELECT count(*) AS count FROM file_object WHERE user_id = ? AND deleted_at IS NULL")
          .bind(userId)
          .first<{ count: number }>(),
        env.DB.prepare(
          "SELECT count(*) AS count FROM file_upload_session WHERE user_id = ? AND status = 'uploading' AND expires_at > ?"
        )
          .bind(userId, timestamp)
          .first<{ count: number }>()
      ])

      const totalCount = (fileCountRow?.count ?? 0) + (uploadCountRow?.count ?? 0)
      if (totalCount >= roleQuota.maxFileCount) {
        throw new HTTPException(403, { message: `File count limit reached (${roleQuota.maxFileCount})` })
      }
    }
  }

  // Global Cloudflare R2 Free Tier guardrail
  await assertGlobalR2Guardrail(env, declaredSize, siteConfig)
}
