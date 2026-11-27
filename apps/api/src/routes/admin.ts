import {
  PERMISSIONS,
  R2_FREE_TIER_BYTES,
  ROLES,
  hasPermission,
  isRole,
  primaryRoleFromRoles,
  updateConfigSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
  type ManagedUser,
  type StorageStats
} from "@notepad/core"
import { Hono } from "hono"
import { canManageConfig, requirePermission, type AppEnv } from "../lib/auth"
import { getSiteConfig, saveSiteConfig } from "../lib/config"
import {
  assignSingleRole,
  getUserById,
  getUserRoles,
  now,
  queueR2Deletion,
  revokeUserActiveShares,
  tryDeleteQueuedR2Object
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"

export const adminRoutes = new Hono<AppEnv>()

adminRoutes.get("/api/config", async (c) => {
  const auth = c.get("auth")
  const includeSecret = Boolean(auth && canManageConfig(auth.user.roles))
  return c.json(await getSiteConfig(c.env, includeSecret))
})

adminRoutes.put("/api/config", async (c) => {
  requirePermission(c, PERMISSIONS.CONFIG_MANAGE)

  try {
    const payload = await parseJson(c, updateConfigSchema)
    if (payload.storageGuardrail.softWarnBytes > payload.storageGuardrail.hardLimitBytes) {
      return c.json({ error: "Soft warn threshold cannot exceed hard limit" }, 400)
    }

    await saveSiteConfig(c.env, {
      adminContact: payload.adminContact,
      turnstile: {
        enabled: payload.turnstile.enabled,
        siteKey: payload.turnstile.siteKey,
        ...(payload.turnstile.secretKey !== undefined ? { secretKey: payload.turnstile.secretKey } : {})
      },
      github: {
        enabled: payload.github.enabled,
        clientId: payload.github.clientId,
        ...(payload.github.clientSecret !== undefined ? { clientSecret: payload.github.clientSecret } : {})
      },
      share: payload.share,
      storageGuardrail: payload.storageGuardrail
    })

    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

adminRoutes.get("/api/admin/users", async (c) => {
  requirePermission(c, PERMISSIONS.USER_MANAGE)

  const rows = await c.env.DB.prepare(
    `SELECT u.id,
            u.username,
            u.email,
            u.name,
            u.avatar_url,
            u.password_hash IS NOT NULL AS has_password,
            u.disabled_at,
            u.created_at,
            GROUP_CONCAT(DISTINCT r.name) AS roles,
            EXISTS(SELECT 1 FROM account a WHERE a.user_id = u.id AND a.provider = 'github') AS has_github,
            (SELECT count(*) FROM file_object f WHERE f.user_id = u.id AND f.deleted_at IS NULL) AS file_count,
            (SELECT COALESCE(SUM(f.size), 0) FROM file_object f WHERE f.user_id = u.id AND f.deleted_at IS NULL) AS storage_bytes,
            (SELECT count(*) FROM note n WHERE n.user_id = u.id AND n.deleted_at IS NULL) AS note_count
     FROM user u
     LEFT JOIN user_role ur ON ur.user_id = u.id
     LEFT JOIN role r ON r.id = ur.role_id
     GROUP BY u.id
     ORDER BY u.created_at ASC`
  ).all<{
    id: string
    username: string | null
    email: string | null
    name: string | null
    avatar_url: string | null
    has_password: number
    disabled_at: number | null
    created_at: number
    roles: string | null
    has_github: number
    file_count: number
    storage_bytes: number
    note_count: number
  }>()

  const users: ManagedUser[] = rows.results.map((row) => {
    const parsedRoles = (row.roles ? row.roles.split(",") : []).filter(isRole)
    const roles = parsedRoles.length ? parsedRoles : [ROLES.PENDING]
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatar_url,
      role: primaryRoleFromRoles(roles),
      roles,
      hasPassword: row.has_password === 1,
      hasGithub: row.has_github === 1,
      fileCount: row.file_count,
      storageBytes: row.storage_bytes,
      noteCount: row.note_count,
      disabledAt: row.disabled_at,
      createdAt: row.created_at
    }
  })

  return c.json({ users })
})

adminRoutes.get("/api/admin/storage-stats", async (c) => {
  requirePermission(c, PERMISSIONS.USER_MANAGE)
  const timestamp = now()
  const siteConfig = await getSiteConfig(c.env, false)

  const [fileStats, docStats, noteStats, userStats, shareStats] = await Promise.all([
    c.env.DB.prepare(
      "SELECT count(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM file_object WHERE deleted_at IS NULL"
    ).first<{ count: number; bytes: number }>(),
    c.env.DB.prepare(
      "SELECT count(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM document WHERE deleted_at IS NULL"
    ).first<{ count: number; bytes: number }>(),
    c.env.DB.prepare("SELECT count(*) AS count FROM note WHERE deleted_at IS NULL").first<{ count: number }>(),
    c.env.DB.prepare("SELECT count(*) AS count FROM user").first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT count(*) AS count FROM share_link WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)"
    )
      .bind(timestamp)
      .first<{ count: number }>()
  ])

  const stats: StorageStats = {
    totalBytes: (fileStats?.bytes ?? 0) + (docStats?.bytes ?? 0),
    totalFiles: fileStats?.count ?? 0,
    totalNotes: (noteStats?.count ?? 0) + (docStats?.count ?? 0),
    totalUsers: userStats?.count ?? 0,
    activeShares: shareStats?.count ?? 0,
    freeTierLimitBytes: R2_FREE_TIER_BYTES,
    softWarnBytes: siteConfig.storageGuardrail.softWarnBytes,
    hardLimitBytes: siteConfig.storageGuardrail.hardLimitBytes,
    hardLimitEnabled: siteConfig.storageGuardrail.hardLimitEnabled
  }

  return c.json({ stats })
})

adminRoutes.patch("/api/admin/users/:userId/role", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.USER_MANAGE)
  const userId = c.req.param("userId")

  try {
    if (auth.user.id === userId) {
      return c.json({ error: "Cannot change your own role" }, 400)
    }

    const user = await getUserById(c.env, userId)
    if (!user) {
      return c.json({ error: "User not found" }, 404)
    }

    const existingRoles = await getUserRoles(c.env, userId)
    if (existingRoles.includes(ROLES.ADMIN)) {
      return c.json({ error: "Cannot change an admin user's role" }, 400)
    }

    const payload = await parseJson(c, updateUserRoleSchema)
    await assignSingleRole(c.env, userId, payload.role)

    // Immediate downgrade enforcement:
    // - All user data and files remain preserved in D1/R2
    // - If new role no longer allows sharing, immediately revoke all active shares
    // - Excess files (>5MB or >100) are locked dynamically in real-time by computeFileAccessSnapshot
    if (!hasPermission([payload.role], PERMISSIONS.SHARE_MANAGE)) {
      await revokeUserActiveShares(c.env, userId)
    }

    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

adminRoutes.patch("/api/admin/users/:userId/status", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.USER_MANAGE)
  const userId = c.req.param("userId")

  try {
    if (auth.user.id === userId) {
      return c.json({ error: "Cannot disable your own account" }, 400)
    }

    const user = await getUserById(c.env, userId)
    if (!user) {
      return c.json({ error: "User not found" }, 404)
    }

    const roles = await getUserRoles(c.env, userId)
    if (roles.includes(ROLES.ADMIN)) {
      return c.json({ error: "Cannot disable an admin user" }, 400)
    }

    const payload = await parseJson(c, updateUserStatusSchema)
    const timestamp = now()

    const batch = [
      c.env.DB.prepare("UPDATE user SET disabled_at = ?, updated_at = ? WHERE id = ?").bind(
        payload.disabled ? timestamp : null,
        timestamp,
        userId
      )
    ]

    if (payload.disabled) {
      batch.push(
        c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(userId),
        c.env.DB.prepare("UPDATE device_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
          timestamp,
          userId
        ),
        c.env.DB.prepare("UPDATE share_link SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
          timestamp,
          userId
        )
      )
    }

    await c.env.DB.batch(batch)
    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

adminRoutes.delete("/api/admin/users/:userId", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.USER_MANAGE)
  const userId = c.req.param("userId")

  if (auth.user.id === userId) {
    return c.json({ error: "Cannot delete your own account" }, 400)
  }

  const user = await getUserById(c.env, userId)
  if (!user) {
    return c.json({ error: "User not found" }, 404)
  }

  const roles = await getUserRoles(c.env, userId)
  if (roles.includes(ROLES.ADMIN)) {
    return c.json({ error: "Cannot delete an admin user" }, 400)
  }

  const [files, docs, uploads] = await Promise.all([
    c.env.DB.prepare("SELECT r2_key FROM file_object WHERE user_id = ?")
      .bind(userId)
      .all<{ r2_key: string }>(),
    c.env.DB.prepare("SELECT r2_key FROM document WHERE user_id = ?")
      .bind(userId)
      .all<{ r2_key: string }>(),
    c.env.DB.prepare(
      "SELECT r2_key, r2_upload_id FROM file_upload_session WHERE user_id = ? AND status = 'uploading'"
    )
      .bind(userId)
      .all<{ r2_key: string; r2_upload_id: string }>()
  ])

  const queued: Array<{ id: string; r2Key: string; r2UploadId: string | null }> = []
  for (const file of files.results) {
    const qId = await queueR2Deletion(c.env, file.r2_key, "user_deleted")
    queued.push({ id: qId, r2Key: file.r2_key, r2UploadId: null })
  }
  for (const doc of docs.results) {
    const qId = await queueR2Deletion(c.env, doc.r2_key, "user_deleted_doc")
    queued.push({ id: qId, r2Key: doc.r2_key, r2UploadId: null })
  }
  for (const upload of uploads.results) {
    const qId = await queueR2Deletion(c.env, upload.r2_key, "user_deleted_upload", upload.r2_upload_id)
    queued.push({ id: qId, r2Key: upload.r2_key, r2UploadId: upload.r2_upload_id })
  }

  await c.env.DB.prepare("DELETE FROM user WHERE id = ?").bind(userId).run()

  // Try immediate cleanup for first 15 objects (respecting Workers Free 50-subrequest budget);
  // any remaining entries are swept by apps/cleanup hourly cron.
  const immediateBatch = queued.slice(0, 15)
  if (immediateBatch.length > 0) {
    c.executionCtx.waitUntil(
      Promise.all(
        immediateBatch.map((item) => tryDeleteQueuedR2Object(c.env, item.id, item.r2Key, item.r2UploadId))
      )
    )
  }

  return c.json({ success: true })
})
