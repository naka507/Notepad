import {
  PERMISSIONS,
  ROLES,
  createShareSchema,
  hasPermission,
  verifyShareSchema,
  type PublicSharePayload,
  type ShareLink
} from "@notepad/core"
import { Hono } from "hono"
import { cookieSecure, getSigningSecret, requirePermission, type AppEnv } from "../lib/auth"
import { getSiteConfig } from "../lib/config"
import { parseCookies, serializeCookie } from "../lib/cookies"
import { hashPassword, randomToken, signPayload, verifyPassword, verifySignedPayload } from "../lib/crypto"
import {
  defaultDocumentContent,
  getUserById,
  getUserRoles,
  now,
  type DocumentRow,
  type FileObjectRow,
  type NoteRow,
  type ShareLinkRow
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"
import { computeFileAccessSnapshot } from "../lib/quota"
import { buildFileResponseHeaders, isSafeInlinePreviewMime, parseRangeHeader } from "../lib/r2"

function shareUnlockCookieName(code: string): string {
  return `notepad_share_${code.slice(0, 12)}`
}

interface ResolvedPublicShare {
  share: ShareLinkRow
  note?: NoteRow
  document?: DocumentRow
  file?: FileObjectRow
}

async function resolveActivePublicShare(
  env: AppEnv["Bindings"],
  code: string
): Promise<ResolvedPublicShare | null> {
  const share = await env.DB.prepare("SELECT * FROM share_link WHERE share_code = ?")
    .bind(code)
    .first<ShareLinkRow>()

  if (!share) return null
  if (share.revoked_at !== null) return null
  if (share.expires_at !== null && share.expires_at <= now()) return null
  if (share.max_views !== null && share.view_count >= share.max_views) return null

  // Zero-delay downgrade / disable enforcement: re-check owner status & SHARE_MANAGE role
  const owner = await getUserById(env, share.user_id)
  if (!owner || owner.disabled_at !== null) return null

  const ownerRoles = await getUserRoles(env, owner.id)
  if (!hasPermission(ownerRoles, PERMISSIONS.SHARE_MANAGE)) return null

  if (share.target_type === "note") {
    const note = await env.DB.prepare(
      "SELECT * FROM note WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    )
      .bind(share.target_id, share.user_id)
      .first<NoteRow>()
    if (!note) return null
    return { share, note }
  }

  if (share.target_type === "document") {
    const doc = await env.DB.prepare(
      "SELECT * FROM document WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    )
      .bind(share.target_id, share.user_id)
      .first<DocumentRow>()
    if (!doc) return null
    return { share, document: doc }
  }

  const file = await env.DB.prepare(
    "SELECT * FROM file_object WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(share.target_id, share.user_id)
    .first<FileObjectRow>()
  if (!file) return null

  const snapshot = await computeFileAccessSnapshot(env, owner.id, ownerRoles)
  if (snapshot.statusById.get(file.id) !== "active") return null

  return { share, file }
}

async function isSharePasswordUnlocked(
  env: AppEnv["Bindings"],
  share: ShareLinkRow,
  cookieHeader: string | null
): Promise<boolean> {
  if (!share.access_password_hash) return true
  const cookies = parseCookies(cookieHeader)
  const token = cookies.get(shareUnlockCookieName(share.share_code))
  if (!token) return false

  const payload = await verifySignedPayload<{ code: string; exp: number }>(token, getSigningSecret(env))
  return payload?.code === share.share_code
}

export const shareRoutes = new Hono<AppEnv>()

shareRoutes.get("/api/shares", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.SHARE_MANAGE)
  const timestamp = now()

  const rows = await c.env.DB.prepare(
    `SELECT s.*,
            n.title AS note_title,
            n.deleted_at AS note_deleted_at,
            d.title AS doc_title,
            d.doc_type AS doc_type,
            d.deleted_at AS doc_deleted_at,
            f.filename AS file_name,
            f.size AS file_size,
            f.mime_type AS file_mime_type,
            f.deleted_at AS file_deleted_at
     FROM share_link s
     LEFT JOIN note n ON s.target_type = 'note' AND n.id = s.target_id
     LEFT JOIN document d ON s.target_type = 'document' AND d.id = s.target_id
     LEFT JOIN file_object f ON s.target_type = 'file' AND f.id = s.target_id
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC
     LIMIT 100`
  )
    .bind(auth.user.id)
    .all<
      ShareLinkRow & {
        note_title: string | null
        note_deleted_at: number | null
        doc_title: string | null
        doc_type: "doc" | "sheet" | null
        doc_deleted_at: number | null
        file_name: string | null
        file_size: number | null
        file_mime_type: string | null
        file_deleted_at: number | null
      }
    >()

  const shares: ShareLink[] = rows.results.map((row) => {
    const targetDeleted =
      row.target_type === "note"
        ? row.note_deleted_at !== null || row.note_title === null
        : row.target_type === "document"
          ? row.doc_deleted_at !== null || row.doc_title === null
          : row.file_deleted_at !== null || row.file_name === null
    const expired = row.expires_at !== null && row.expires_at <= timestamp
    const viewsExhausted = row.max_views !== null && row.view_count >= row.max_views
    const isActive = row.revoked_at === null && !expired && !viewsExhausted && !targetDeleted

    const targetTitle =
      row.target_type === "note"
        ? row.note_title || "Untitled"
        : row.target_type === "document"
          ? row.doc_title || "Untitled"
          : row.file_name || "Deleted file"

    return {
      id: row.id,
      shareCode: row.share_code,
      targetType: row.target_type,
      targetId: row.target_id,
      targetTitle,
      ...(row.target_type === "document" ? { targetDocType: row.doc_type } : {}),
      targetSize: row.target_type === "file" ? row.file_size : null,
      targetMimeType: row.target_type === "file" ? row.file_mime_type : null,
      permission: row.permission,
      hasPassword: Boolean(row.access_password_hash),
      maxViews: row.max_views,
      viewCount: row.view_count,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      isActive,
      createdAt: row.created_at
    }
  })

  return c.json({ shares })
})

shareRoutes.post("/api/shares", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.SHARE_MANAGE)

  try {
    const payload = await parseJson(c, createShareSchema)
    const siteConfig = await getSiteConfig(c.env, false)
    const isAdmin = auth.user.roles.includes(ROLES.ADMIN)

    let targetTitle = ""
    let targetDocType: "doc" | "sheet" | null = null
    let targetSize: number | null = null
    let targetMimeType: string | null = null

    if (payload.targetType === "note") {
      const note = await c.env.DB.prepare(
        "SELECT id, title FROM note WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
      )
        .bind(payload.targetId, auth.user.id)
        .first<{ id: string; title: string }>()
      if (!note) {
        return c.json({ error: "Note not found" }, 404)
      }
      targetTitle = note.title || "Untitled"
    } else if (payload.targetType === "document") {
      const doc = await c.env.DB.prepare(
        "SELECT id, title, doc_type FROM document WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
      )
        .bind(payload.targetId, auth.user.id)
        .first<{ id: string; title: string; doc_type: "doc" | "sheet" }>()
      if (!doc) {
        return c.json({ error: "Document not found" }, 404)
      }
      targetTitle = doc.title || "Untitled"
      targetDocType = doc.doc_type
    } else {
      const file = await c.env.DB.prepare(
        "SELECT id, filename, size, mime_type FROM file_object WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
      )
        .bind(payload.targetId, auth.user.id)
        .first<{ id: string; filename: string; size: number; mime_type: string }>()
      if (!file) {
        return c.json({ error: "File not found" }, 404)
      }

      const snapshot = await computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)
      if (snapshot.statusById.get(file.id) !== "active") {
        return c.json({ error: "Locked files cannot be shared" }, 403)
      }

      targetTitle = file.filename
      targetSize = file.size
      targetMimeType = file.mime_type
    }

    const ttlSec = payload.ttlSec !== undefined ? payload.ttlSec : siteConfig.share.defaultTtlSec
    let expiresAt: number | null
    const timestamp = now()

    if (isAdmin) {
      expiresAt = ttlSec === 0 ? null : timestamp + ttlSec * 1000
    } else {
      if (ttlSec <= 0 || ttlSec > siteConfig.share.memberMaxTtlSec) {
        return c.json(
          { error: `Share expiry must be between 60s and ${siteConfig.share.memberMaxTtlSec}s` },
          400
        )
      }
      expiresAt = timestamp + ttlSec * 1000
    }

    let passwordHash: string | null = null
    let passwordSalt: string | null = null
    if (payload.accessPassword) {
      const hashed = await hashPassword(payload.accessPassword)
      passwordHash = hashed.hash
      passwordSalt = hashed.salt
    }

    const id = crypto.randomUUID()
    const shareCode = randomToken(16)

    await c.env.DB.prepare(
      `INSERT INTO share_link (
         id, share_code, user_id, target_type, target_id, permission,
         access_password_hash, access_password_salt, max_views, view_count, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
      .bind(
        id,
        shareCode,
        auth.user.id,
        payload.targetType,
        payload.targetId,
        payload.permission,
        passwordHash,
        passwordSalt,
        payload.maxViews ?? null,
        expiresAt,
        timestamp
      )
      .run()

    const share: ShareLink = {
      id,
      shareCode,
      targetType: payload.targetType,
      targetId: payload.targetId,
      targetTitle,
      ...(payload.targetType === "document" ? { targetDocType } : {}),
      targetSize,
      targetMimeType,
      permission: payload.permission,
      hasPassword: Boolean(passwordHash),
      maxViews: payload.maxViews ?? null,
      viewCount: 0,
      expiresAt,
      revokedAt: null,
      isActive: true,
      createdAt: timestamp
    }

    return c.json({ share }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

shareRoutes.delete("/api/shares/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.SHARE_MANAGE)
  const id = c.req.param("id")

  await c.env.DB.prepare(
    "UPDATE share_link SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
  )
    .bind(now(), id, auth.user.id)
    .run()

  return c.json({ success: true })
})

shareRoutes.get("/api/public/shares/:code", async (c) => {
  const code = c.req.param("code")
  const resolved = await resolveActivePublicShare(c.env, code)

  c.header("Cache-Control", "no-store")
  c.header("X-Robots-Tag", "noindex, nofollow")

  if (!resolved) {
    return c.json({ error: "Share link expired or unavailable" }, 410)
  }

  const { share, note, document: doc, file } = resolved
  const unlocked = await isSharePasswordUnlocked(c.env, share, c.req.header("Cookie") ?? null)

  if (!unlocked) {
    const payload: PublicSharePayload = {
      shareCode: share.share_code,
      targetType: share.target_type,
      permission: share.permission,
      requiresPassword: true,
      expiresAt: share.expires_at,
      viewCount: share.view_count,
      maxViews: share.max_views
    }
    return c.json({ share: payload })
  }

  await c.env.DB.prepare("UPDATE share_link SET view_count = view_count + 1 WHERE id = ?")
    .bind(share.id)
    .run()

  let docContent: Record<string, unknown> | undefined
  if (doc) {
    const object = await c.env.FILES_BUCKET.get(doc.r2_key)
    try {
      docContent = object ? ((await object.json()) as Record<string, unknown>) : defaultDocumentContent(doc.doc_type)
    } catch {
      docContent = defaultDocumentContent(doc.doc_type)
    }
  }

  const payload: PublicSharePayload = {
    shareCode: share.share_code,
    targetType: share.target_type,
    permission: share.permission,
    requiresPassword: false,
    expiresAt: share.expires_at,
    viewCount: share.view_count + 1,
    maxViews: share.max_views,
    ...(note
      ? {
          note: {
            title: note.title,
            content: note.content,
            updatedAt: note.updated_at
          }
        }
      : {}),
    ...(doc && docContent
      ? {
          document: {
            title: doc.title,
            docType: doc.doc_type,
            content: docContent,
            updatedAt: doc.updated_at
          }
        }
      : {}),
    ...(file
      ? {
          file: {
            filename: file.filename,
            mimeType: file.mime_type,
            size: file.size,
            updatedAt: file.updated_at,
            previewable: isSafeInlinePreviewMime(file.mime_type)
          }
        }
      : {})
  }

  return c.json({ share: payload })
})

shareRoutes.post("/api/public/shares/:code/verify", async (c) => {
  const code = c.req.param("code")
  const resolved = await resolveActivePublicShare(c.env, code)
  if (!resolved) {
    return c.json({ error: "Share link expired or unavailable" }, 410)
  }

  const { share } = resolved
  if (!share.access_password_hash || !share.access_password_salt) {
    return c.json({ success: true })
  }

  try {
    const payload = await parseJson(c, verifyShareSchema)
    const valid = await verifyPassword(
      payload.password,
      share.access_password_salt,
      share.access_password_hash
    )
    if (!valid) {
      return c.json({ error: "Invalid access password" }, 401)
    }

    const token = await signPayload(
      { code: share.share_code, exp: now() + 60 * 60 * 1000 },
      getSigningSecret(c.env)
    )
    c.header(
      "Set-Cookie",
      serializeCookie(shareUnlockCookieName(share.share_code), token, {
        maxAge: 3600,
        httpOnly: true,
        sameSite: "Lax",
        secure: cookieSecure(c),
        path: "/"
      })
    )
    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

shareRoutes.get("/api/public/shares/:code/download", async (c) => {
  const code = c.req.param("code")
  const resolved = await resolveActivePublicShare(c.env, code)
  if (!resolved || !resolved.file) {
    return c.json({ error: "Share link expired or unavailable" }, 410)
  }

  const { share, file } = resolved
  const unlocked = await isSharePasswordUnlocked(c.env, share, c.req.header("Cookie") ?? null)
  if (!unlocked) {
    return c.json({ error: "Password required" }, 401)
  }

  const inlineRequested = c.req.query("inline") === "1"
  const forceDownload = !inlineRequested || share.permission === "download" && !inlineRequested
  if (share.permission === "view" && !inlineRequested) {
    return c.json({ error: "Download disabled for this share" }, 403)
  }

  const range = parseRangeHeader(c.req.header("Range") ?? null, file.size)
  const object = range
    ? await c.env.FILES_BUCKET.get(file.r2_key, { range: { offset: range.offset, length: range.length } })
    : await c.env.FILES_BUCKET.get(file.r2_key)

  if (!object) {
    return c.json({ error: "Stored file not found" }, 404)
  }

  const headers = buildFileResponseHeaders({
    filename: file.filename,
    mimeType: file.mime_type,
    size: file.size,
    etag: object.httpEtag,
    forceDownload,
    isPublicShare: true
  })

  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${file.size}`)
    headers.set("Content-Length", String(range.length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set("Content-Length", String(object.size))
  return new Response(object.body, { status: 200, headers })
})
