import {
  FILE_PAGE_SIZE,
  PERMISSIONS,
  SINGLE_UPLOAD_MAX_BYTES,
  UPLOAD_SESSION_TTL_MS,
  decodeCursor,
  encodeCursor,
  multipartCompleteSchema,
  multipartInitSchema,
  partSizeForFileSize,
  quotaForRoles,
  updateFileSchema,
  type FileAccessStatus,
  type FileItem
} from "@notepad/core"
import { Hono } from "hono"
import { requirePermission, type AppEnv } from "../lib/auth"
import { getSiteConfig } from "../lib/config"
import {
  nextSyncSeq,
  now,
  queueR2Deletion,
  revokeTargetActiveShares,
  tryDeleteQueuedR2Object,
  type FileObjectRow,
  type UploadSessionRow
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"
import { assertUploadAllowed, computeFileAccessSnapshot } from "../lib/quota"
import {
  ContentLengthMismatchError,
  FileTooLargeError,
  buildFileResponseHeaders,
  buildR2Key,
  parseRangeHeader,
  streamToR2WithLimit
} from "../lib/r2"

function fileItemFromRow(row: FileObjectRow, accessStatus: FileAccessStatus): FileItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    sha256: row.sha256,
    accessStatus,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export const fileRoutes = new Hono<AppEnv>()

fileRoutes.get("/api/files", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const categoryId = c.req.query("categoryId")
  const query = c.req.query("q")?.trim()
  const cursor = c.req.query("cursor")

  const snapshot = await computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)

  const conditions = ["user_id = ?", "deleted_at IS NULL"]
  const binds: (string | number)[] = [auth.user.id]

  if (categoryId === "default" || categoryId === "uncategorized") {
    conditions.push("category_id IS NULL")
  } else if (categoryId) {
    conditions.push("category_id = ?")
    binds.push(categoryId)
  }

  if (query) {
    conditions.push("filename LIKE ?")
    binds.push(`%${query}%`)
  }

  const countWhere = conditions.join(" AND ")
  const countBinds = [...binds]

  if (cursor) {
    try {
      const decoded = decodeCursor(cursor)
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))")
      binds.push(decoded.timestamp, decoded.timestamp, decoded.id)
    } catch {
      return c.json({ error: "Invalid cursor" }, 400)
    }
  }

  const [totalRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT count(*) AS count FROM file_object WHERE ${countWhere}`)
      .bind(...countBinds)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT *
       FROM file_object
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
      .bind(...binds, FILE_PAGE_SIZE + 1)
      .all<FileObjectRow>()
  ])

  const hasMore = rows.results.length > FILE_PAGE_SIZE
  const items = rows.results
    .slice(0, FILE_PAGE_SIZE)
    .map((row) => fileItemFromRow(row, snapshot.statusById.get(row.id) ?? "active"))
  const last = items.at(-1)

  return c.json({
    items,
    total: totalRow?.count ?? 0,
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.createdAt, id: last.id }) : null,
    quota: snapshot.quota
  })
})

/**
 * Single-part streaming upload for files <= 5 MiB.
 * Supports:
 * 1) Raw binary stream with headers: X-File-Name (URI-encoded), X-File-Mime, X-File-Size, X-File-Category, X-File-Sha256
 * 2) multipart/form-data (field "file", optional "categoryId", optional "sha256")
 */
fileRoutes.post("/api/files/upload", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const siteConfig = await getSiteConfig(c.env, false)
  const contentType = c.req.header("Content-Type") || ""

  let filename = ""
  let mimeType = "application/octet-stream"
  let declaredSize = 0
  let categoryId: string | null = null
  let clientSha256: string | null = null
  let bodyStream: ReadableStream<Uint8Array> | null = null

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData()
    const fileEntry = form.get("file")
    if (!fileEntry || typeof fileEntry === "string") {
      return c.json({ error: "Missing file field" }, 400)
    }
    const file = fileEntry as File
    filename = file.name || "unnamed"
    mimeType = file.type || "application/octet-stream"
    declaredSize = file.size
    const rawCat = form.get("categoryId")
    categoryId = typeof rawCat === "string" && rawCat.trim() ? rawCat.trim() : null
    const rawSha = form.get("sha256")
    clientSha256 =
      typeof rawSha === "string" && /^[a-fA-F0-9]{64}$/.test(rawSha.trim()) ? rawSha.trim().toLowerCase() : null
    bodyStream = file.stream() as unknown as ReadableStream<Uint8Array>
  } else {
    const rawName = c.req.header("X-File-Name")
    if (!rawName) {
      return c.json({ error: "Missing X-File-Name header" }, 400)
    }
    try {
      filename = decodeURIComponent(rawName).trim()
    } catch {
      filename = rawName.trim()
    }
    mimeType = (c.req.header("X-File-Mime") || "application/octet-stream").trim()
    declaredSize = Number(c.req.header("X-File-Size") || c.req.header("Content-Length") || 0)
    const rawCat = c.req.header("X-File-Category")
    categoryId = rawCat && rawCat.trim() ? rawCat.trim() : null
    const rawSha = c.req.header("X-File-Sha256")
    clientSha256 = rawSha && /^[a-fA-F0-9]{64}$/.test(rawSha.trim()) ? rawSha.trim().toLowerCase() : null
    bodyStream = c.req.raw.body as ReadableStream<Uint8Array> | null
  }

  if (!filename || filename.length > 255) {
    return c.json({ error: "Invalid filename" }, 400)
  }
  if (!bodyStream) {
    return c.json({ error: "Empty request body" }, 400)
  }
  if (declaredSize > SINGLE_UPLOAD_MAX_BYTES) {
    return c.json({ error: "Files larger than 5 MB must use multipart upload" }, 413)
  }

  await assertUploadAllowed(c.env, auth.user.id, auth.user.roles, declaredSize, siteConfig)

  if (categoryId) {
    const cat = await c.env.DB.prepare(
      "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'file' AND deleted_at IS NULL"
    )
      .bind(categoryId, auth.user.id)
      .first()
    if (!cat) {
      return c.json({ error: "Category not found" }, 404)
    }
  }

  const roleQuota = quotaForRoles(auth.user.roles)
  const hardByteCap =
    roleQuota.maxFileSize !== null
      ? Math.min(SINGLE_UPLOAD_MAX_BYTES, roleQuota.maxFileSize)
      : SINGLE_UPLOAD_MAX_BYTES

  const fileId = crypto.randomUUID()
  const timestamp = now()
  const r2Key = buildR2Key(auth.user.id, fileId, timestamp)

  let actualSize = 0
  try {
    const { result: object, bytes } = await streamToR2WithLimit({
      source: bodyStream,
      expectedBytes: declaredSize > 0 ? declaredSize : null,
      maxBytes: hardByteCap,
      consume: (body) =>
        c.env.FILES_BUCKET.put(r2Key, body, {
          httpMetadata: { contentType: mimeType },
          ...(clientSha256 ? { sha256: clientSha256 } : {})
        })
    })
    actualSize = object?.size ?? bytes
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return c.json({ error: "File exceeds allowed size limit" }, 413)
    }
    if (error instanceof ContentLengthMismatchError) {
      return c.json({ error: error.message }, 400)
    }
    throw error
  }

  if (actualSize <= 0 || actualSize > hardByteCap) {
    await c.env.FILES_BUCKET.delete(r2Key)
    return c.json({ error: "Invalid uploaded file size" }, 400)
  }

  const syncSeq = await nextSyncSeq(c.env, auth.user.id)
  await c.env.DB.prepare(
    `INSERT INTO file_object (id, user_id, category_id, filename, mime_type, size, sha256, r2_key, version, sync_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  )
    .bind(
      fileId,
      auth.user.id,
      categoryId,
      filename,
      mimeType,
      actualSize,
      clientSha256,
      r2Key,
      syncSeq,
      timestamp,
      timestamp
    )
    .run()

  const row = await c.env.DB.prepare("SELECT * FROM file_object WHERE id = ?")
    .bind(fileId)
    .first<FileObjectRow>()

  return c.json({ file: row ? fileItemFromRow(row, "active") : null }, 201)
})

fileRoutes.post("/api/files/multipart/init", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)

  try {
    const payload = await parseJson(c, multipartInitSchema)
    const siteConfig = await getSiteConfig(c.env, false)
    await assertUploadAllowed(c.env, auth.user.id, auth.user.roles, payload.size, siteConfig)

    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'file' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) {
        return c.json({ error: "Category not found" }, 404)
      }
    }

    const sessionId = crypto.randomUUID()
    const fileId = crypto.randomUUID()
    const timestamp = now()
    const r2Key = buildR2Key(auth.user.id, fileId, timestamp)
    const partSize = partSizeForFileSize(payload.size)
    const totalParts = Math.ceil(payload.size / partSize)

    const multipart = await c.env.FILES_BUCKET.createMultipartUpload(r2Key, {
      httpMetadata: { contentType: payload.mimeType }
    })

    await c.env.DB.prepare(
      `INSERT INTO file_upload_session (
         id, user_id, category_id, filename, mime_type, declared_size, part_size,
         r2_key, r2_upload_id, parts_json, status, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'uploading', ?, ?, ?)`
    )
      .bind(
        sessionId,
        auth.user.id,
        payload.categoryId ?? null,
        payload.filename,
        payload.mimeType,
        payload.size,
        partSize,
        r2Key,
        multipart.uploadId,
        timestamp + UPLOAD_SESSION_TTL_MS,
        timestamp,
        timestamp
      )
      .run()

    return c.json(
      {
        uploadSessionId: sessionId,
        partSize,
        totalParts
      },
      201
    )
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

fileRoutes.put("/api/files/multipart/:sessionId/parts/:partNumber", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const sessionId = c.req.param("sessionId")
  const partNumber = Number(c.req.param("partNumber"))

  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return c.json({ error: "Invalid part number" }, 400)
  }

  const session = await c.env.DB.prepare(
    "SELECT * FROM file_upload_session WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, auth.user.id)
    .first<UploadSessionRow>()

  if (!session || session.status !== "uploading" || session.expires_at <= now()) {
    return c.json({ error: "Upload session not found or expired" }, 404)
  }

  const rawBody = c.req.raw.body as ReadableStream<Uint8Array> | null
  if (!rawBody) {
    return c.json({ error: "Empty part payload" }, 400)
  }

  const contentLengthHeader = c.req.header("Content-Length")
  const expectedPartBytes = contentLengthHeader ? Number(contentLengthHeader) : null

  let uploadedPart: R2UploadedPart
  try {
    const upload = c.env.FILES_BUCKET.resumeMultipartUpload(session.r2_key, session.r2_upload_id)
    const { result } = await streamToR2WithLimit({
      source: rawBody,
      expectedBytes:
        expectedPartBytes !== null && Number.isInteger(expectedPartBytes) && expectedPartBytes > 0
          ? expectedPartBytes
          : null,
      maxBytes: session.part_size,
      consume: (body) => upload.uploadPart(partNumber, body)
    })
    uploadedPart = result
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return c.json({ error: "Part exceeds allowed part size" }, 413)
    }
    if (error instanceof ContentLengthMismatchError) {
      return c.json({ error: error.message }, 400)
    }
    throw error
  }

  let parts: Array<{ partNumber: number; etag: string }> = []
  try {
    const parsed = JSON.parse(session.parts_json) as unknown
    if (Array.isArray(parsed)) {
      parts = parsed as Array<{ partNumber: number; etag: string }>
    }
  } catch {
    parts = []
  }

  const filtered = parts.filter((p) => p.partNumber !== partNumber)
  filtered.push({ partNumber: uploadedPart.partNumber, etag: uploadedPart.etag })
  filtered.sort((a, b) => a.partNumber - b.partNumber)

  await c.env.DB.prepare(
    "UPDATE file_upload_session SET parts_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(JSON.stringify(filtered), now(), session.id)
    .run()

  return c.json({
    partNumber: uploadedPart.partNumber,
    etag: uploadedPart.etag
  })
})

fileRoutes.post("/api/files/multipart/:sessionId/complete", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const sessionId = c.req.param("sessionId")

  try {
    const payload = await parseJson(c, multipartCompleteSchema)
    const session = await c.env.DB.prepare(
      "SELECT * FROM file_upload_session WHERE id = ? AND user_id = ?"
    )
      .bind(sessionId, auth.user.id)
      .first<UploadSessionRow>()

    if (!session || session.status !== "uploading" || session.expires_at <= now()) {
      return c.json({ error: "Upload session not found or expired" }, 404)
    }

    const sortedParts = [...payload.parts].sort((a, b) => a.partNumber - b.partNumber)
    const upload = c.env.FILES_BUCKET.resumeMultipartUpload(session.r2_key, session.r2_upload_id)
    const completed = await upload.complete(sortedParts)

    const actualSize = completed.size
    const roleQuota = quotaForRoles(auth.user.roles)
    const siteConfig = await getSiteConfig(c.env, false)

    // Final safety check on real assembled size against current role limit
    if (!roleQuota.unlimited && roleQuota.maxFileSize !== null && actualSize > roleQuota.maxFileSize) {
      await c.env.FILES_BUCKET.delete(session.r2_key)
      await c.env.DB.prepare("UPDATE file_upload_session SET status = 'aborted', updated_at = ? WHERE id = ?")
        .bind(now(), session.id)
        .run()
      return c.json({ error: "Assembled file exceeds role size limit" }, 413)
    }

    if (siteConfig.storageGuardrail.hardLimitEnabled) {
      const storedRow = await c.env.DB.prepare(
        "SELECT COALESCE(SUM(size), 0) AS bytes FROM file_object WHERE deleted_at IS NULL"
      ).first<{ bytes: number }>()
      if ((storedRow?.bytes ?? 0) + actualSize > siteConfig.storageGuardrail.hardLimitBytes) {
        await c.env.FILES_BUCKET.delete(session.r2_key)
        await c.env.DB.prepare("UPDATE file_upload_session SET status = 'aborted', updated_at = ? WHERE id = ?")
          .bind(now(), session.id)
          .run()
        return c.json({ error: "Storage capacity reached Cloudflare free-tier guardrail" }, 507)
      }
    }

    const fileId = crypto.randomUUID()
    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO file_object (id, user_id, category_id, filename, mime_type, size, sha256, r2_key, version, sync_seq, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      ).bind(
        fileId,
        auth.user.id,
        session.category_id,
        session.filename,
        session.mime_type,
        actualSize,
        payload.sha256 ? payload.sha256.toLowerCase() : null,
        session.r2_key,
        syncSeq,
        timestamp,
        timestamp
      ),
      c.env.DB.prepare("UPDATE file_upload_session SET status = 'completed', updated_at = ? WHERE id = ?").bind(
        timestamp,
        session.id
      )
    ])

    const snapshot = await computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)
    const row = await c.env.DB.prepare("SELECT * FROM file_object WHERE id = ?")
      .bind(fileId)
      .first<FileObjectRow>()

    return c.json(
      {
        file: row ? fileItemFromRow(row, snapshot.statusById.get(row.id) ?? "active") : null
      },
      201
    )
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

fileRoutes.delete("/api/files/multipart/:sessionId", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const sessionId = c.req.param("sessionId")

  const session = await c.env.DB.prepare(
    "SELECT * FROM file_upload_session WHERE id = ? AND user_id = ?"
  )
    .bind(sessionId, auth.user.id)
    .first<UploadSessionRow>()

  if (!session || session.status !== "uploading") {
    return c.json({ success: true })
  }

  await c.env.DB.prepare("UPDATE file_upload_session SET status = 'aborted', updated_at = ? WHERE id = ?")
    .bind(now(), session.id)
    .run()

  const queueId = await queueR2Deletion(c.env, session.r2_key, "multipart_aborted", session.r2_upload_id)
  c.executionCtx.waitUntil(tryDeleteQueuedR2Object(c.env, queueId, session.r2_key, session.r2_upload_id))

  return c.json({ success: true })
})

fileRoutes.patch("/api/files/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const id = c.req.param("id")

  try {
    const existing = await c.env.DB.prepare(
      "SELECT * FROM file_object WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    )
      .bind(id, auth.user.id)
      .first<FileObjectRow>()
    if (!existing) {
      return c.json({ error: "File not found" }, 404)
    }

    const snapshot = await computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)
    const status = snapshot.statusById.get(existing.id) ?? "locked_role"
    if (status !== "active") {
      return c.json({ error: "File is locked under your current role quota", code: status }, 403)
    }

    const payload = await parseJson(c, updateFileSchema)
    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'file' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) {
        return c.json({ error: "Category not found" }, 404)
      }
    }

    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `UPDATE file_object
       SET filename = ?, category_id = ?, version = version + 1, sync_seq = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        payload.filename ?? existing.filename,
        payload.categoryId !== undefined ? payload.categoryId : existing.category_id,
        syncSeq,
        timestamp,
        id,
        auth.user.id
      )
      .run()

    const updated = await c.env.DB.prepare("SELECT * FROM file_object WHERE id = ?")
      .bind(id)
      .first<FileObjectRow>()

    return c.json({ file: updated ? fileItemFromRow(updated, "active") : null })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

fileRoutes.delete("/api/files/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT * FROM file_object WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<FileObjectRow>()
  if (!existing) {
    return c.json({ error: "File not found" }, 404)
  }

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  await revokeTargetActiveShares(c.env, "file", id)
  await c.env.DB.prepare(
    "UPDATE file_object SET deleted_at = ?, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(timestamp, syncSeq, timestamp, id, auth.user.id)
    .run()

  const queueId = await queueR2Deletion(c.env, existing.r2_key, "file_deleted")
  c.executionCtx.waitUntil(tryDeleteQueuedR2Object(c.env, queueId, existing.r2_key))

  return c.json({ success: true })
})

fileRoutes.get("/api/files/:id/content", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.FILE_MANAGE)
  const id = c.req.param("id")

  const file = await c.env.DB.prepare(
    "SELECT * FROM file_object WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<FileObjectRow>()
  if (!file) {
    return c.json({ error: "File not found" }, 404)
  }

  // Real-time role & downgrade lock check: locked files cannot be previewed or downloaded
  const snapshot = await computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)
  const accessStatus = snapshot.statusById.get(file.id) ?? "locked_role"
  if (accessStatus !== "active") {
    return c.json({ error: "File is locked under your current role quota", code: accessStatus }, 403)
  }

  const forceDownload = c.req.query("download") === "1"
  const range = parseRangeHeader(c.req.header("Range") ?? null, file.size)

  const object = range
    ? await c.env.FILES_BUCKET.get(file.r2_key, { range: { offset: range.offset, length: range.length } })
    : await c.env.FILES_BUCKET.get(file.r2_key)

  if (!object) {
    return c.json({ error: "Stored object not found" }, 404)
  }

  const headers = buildFileResponseHeaders({
    filename: file.filename,
    mimeType: file.mime_type,
    size: file.size,
    etag: object.httpEtag,
    forceDownload,
    isPublicShare: false
  })

  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${file.size}`)
    headers.set("Content-Length", String(range.length))
    return new Response(object.body, { status: 206, headers })
  }

  headers.set("Content-Length", String(object.size))
  return new Response(object.body, { status: 200, headers })
})
