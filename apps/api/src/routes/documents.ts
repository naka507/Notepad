import {
  DOCUMENT_MAX_BODY_BYTES,
  DOCUMENT_PAGE_SIZE,
  PERMISSIONS,
  createDocumentSchema,
  decodeCursor,
  encodeCursor,
  updateDocumentSchema,
  type DocumentDetail,
  type DocumentSummary
} from "@notepad/core"
import { Hono } from "hono"
import { requirePermission, type AppEnv } from "../lib/auth"
import { getSiteConfig } from "../lib/config"
import {
  buildDocumentR2Key,
  defaultDocumentContent,
  nextSyncSeq,
  now,
  queueR2Deletion,
  revokeTargetActiveShares,
  tryDeleteQueuedR2Object,
  type DocumentRow
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"
import { assertGlobalR2Guardrail } from "../lib/quota"

const encoder = new TextEncoder()

function categoryScopeForDocType(docType: "doc" | "sheet"): "document" | "sheet" {
  return docType === "sheet" ? "sheet" : "document"
}

function docSummaryFromRow(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    categoryId: row.category_id,
    docType: row.doc_type,
    title: row.title,
    excerpt: row.excerpt,
    size: row.size,
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function readDocBodyFromR2(
  env: AppEnv["Bindings"],
  row: DocumentRow
): Promise<Record<string, unknown>> {
  const object = await env.FILES_BUCKET.get(row.r2_key)
  if (!object) return defaultDocumentContent(row.doc_type)
  try {
    return (await object.json()) as Record<string, unknown>
  } catch {
    return defaultDocumentContent(row.doc_type)
  }
}

export const documentRoutes = new Hono<AppEnv>()

documentRoutes.get("/api/documents", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const view = c.req.query("view") || "archived"
  const docType = c.req.query("docType")
  const categoryId = c.req.query("categoryId")
  const query = c.req.query("q")?.trim()
  const cursor = c.req.query("cursor")

  const conditions = ["user_id = ?"]
  const binds: (string | number)[] = [auth.user.id]

  if (view === "trash") {
    conditions.push("deleted_at IS NOT NULL")
  } else {
    conditions.push("deleted_at IS NULL")
  }

  if (docType === "doc" || docType === "sheet") {
    conditions.push("doc_type = ?")
    binds.push(docType)
  }

  if (categoryId === "default" || categoryId === "uncategorized") {
    conditions.push("category_id IS NULL")
  } else if (categoryId) {
    conditions.push("category_id = ?")
    binds.push(categoryId)
  }

  if (query) {
    conditions.push("(title LIKE ? OR excerpt LIKE ?)")
    const pattern = `%${query}%`
    binds.push(pattern, pattern)
  }

  const countWhere = conditions.join(" AND ")
  const countBinds = [...binds]

  if (cursor) {
    try {
      const decoded = decodeCursor(cursor)
      conditions.push("(updated_at < ? OR (updated_at = ? AND id < ?))")
      binds.push(decoded.timestamp, decoded.timestamp, decoded.id)
    } catch {
      return c.json({ error: "Invalid cursor" }, 400)
    }
  }

  const [totalRow, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT count(*) AS count FROM document WHERE ${countWhere}`)
      .bind(...countBinds)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT *
       FROM document
       WHERE ${conditions.join(" AND ")}
       ORDER BY is_pinned DESC, updated_at DESC, id DESC
       LIMIT ?`
    )
      .bind(...binds, DOCUMENT_PAGE_SIZE + 1)
      .all<DocumentRow>()
  ])

  const hasMore = rows.results.length > DOCUMENT_PAGE_SIZE
  const items = rows.results.slice(0, DOCUMENT_PAGE_SIZE).map(docSummaryFromRow)
  const last = items.at(-1)

  return c.json({
    items,
    total: totalRow?.count ?? 0,
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.updatedAt, id: last.id }) : null
  })
})

documentRoutes.post("/api/documents", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)

  try {
    const payload = await parseJson(c, createDocumentSchema)
    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = ? AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id, categoryScopeForDocType(payload.docType))
        .first()
      if (!cat) return c.json({ error: "Category not found" }, 404)
    }

    const bodyObj = payload.content ?? defaultDocumentContent(payload.docType)
    const encoded = encoder.encode(JSON.stringify(bodyObj))
    if (encoded.byteLength > DOCUMENT_MAX_BODY_BYTES) {
      return c.json({ error: "Document size exceeds 5 MB limit" }, 413)
    }

    const siteConfig = await getSiteConfig(c.env, false)
    await assertGlobalR2Guardrail(c.env, encoded.byteLength, siteConfig)

    const id = crypto.randomUUID()
    const timestamp = now()
    const r2Key = buildDocumentR2Key(auth.user.id, id)

    await c.env.FILES_BUCKET.put(r2Key, encoded, {
      httpMetadata: { contentType: "application/json" }
    })

    const syncSeq = await nextSyncSeq(c.env, auth.user.id)
    await c.env.DB.prepare(
      `INSERT INTO document (
         id, user_id, category_id, doc_type, title, excerpt, r2_key, size,
         is_pinned, is_archived, version, sync_seq, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.user.id,
        payload.categoryId ?? null,
        payload.docType,
        payload.title,
        payload.excerpt,
        r2Key,
        encoded.byteLength,
        payload.isPinned ? 1 : 0,
        syncSeq,
        timestamp,
        timestamp
      )
      .run()

    const created = await c.env.DB.prepare("SELECT * FROM document WHERE id = ?")
      .bind(id)
      .first<DocumentRow>()

    const detail: DocumentDetail | null = created
      ? { ...docSummaryFromRow(created), content: bodyObj }
      : null

    return c.json({ document: detail }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

documentRoutes.get("/api/documents/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const row = await c.env.DB.prepare("SELECT * FROM document WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .first<DocumentRow>()
  if (!row) return c.json({ error: "Document not found" }, 404)

  const content = await readDocBodyFromR2(c.env, row)
  const detail: DocumentDetail = {
    ...docSummaryFromRow(row),
    content
  }
  return c.json({ document: detail })
})

documentRoutes.patch("/api/documents/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  try {
    const existing = await c.env.DB.prepare("SELECT * FROM document WHERE id = ? AND user_id = ?")
      .bind(id, auth.user.id)
      .first<DocumentRow>()
    if (!existing || existing.deleted_at !== null) {
      return c.json({ error: "Document not found" }, 404)
    }

    const payload = await parseJson(c, updateDocumentSchema)
    if (payload.baseVersion !== undefined && payload.baseVersion !== existing.version) {
      const currentBody = await readDocBodyFromR2(c.env, existing)
      return c.json(
        {
          error: "Version conflict",
          code: "VERSION_CONFLICT",
          current: { ...docSummaryFromRow(existing), content: currentBody }
        },
        409
      )
    }

    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = ? AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id, categoryScopeForDocType(existing.doc_type))
        .first()
      if (!cat) return c.json({ error: "Category not found" }, 404)
    }

    let nextSize = existing.size
    let bodyObj: Record<string, unknown> | null = null

    if (payload.content !== undefined) {
      const encoded = encoder.encode(JSON.stringify(payload.content))
      if (encoded.byteLength > DOCUMENT_MAX_BODY_BYTES) {
        return c.json({ error: "Document size exceeds 5 MB limit" }, 413)
      }
      const delta = encoded.byteLength - existing.size
      if (delta > 0) {
        const siteConfig = await getSiteConfig(c.env, false)
        await assertGlobalR2Guardrail(c.env, delta, siteConfig)
      }
      await c.env.FILES_BUCKET.put(existing.r2_key, encoded, {
        httpMetadata: { contentType: "application/json" }
      })
      nextSize = encoded.byteLength
      bodyObj = payload.content
    }

    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `UPDATE document
       SET category_id = ?, title = ?, excerpt = ?, size = ?, is_pinned = ?, is_archived = ?,
           version = version + 1, sync_seq = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        payload.categoryId !== undefined ? payload.categoryId : existing.category_id,
        payload.title !== undefined ? payload.title : existing.title,
        payload.excerpt !== undefined ? payload.excerpt : existing.excerpt,
        nextSize,
        payload.isPinned !== undefined ? (payload.isPinned ? 1 : 0) : existing.is_pinned,
        payload.isArchived !== undefined ? (payload.isArchived ? 1 : 0) : existing.is_archived,
        syncSeq,
        timestamp,
        id,
        auth.user.id
      )
      .run()

    const updated = await c.env.DB.prepare("SELECT * FROM document WHERE id = ?")
      .bind(id)
      .first<DocumentRow>()

    if (!updated) return c.json({ error: "Document not found" }, 404)
    const resolvedBody = bodyObj ?? (await readDocBodyFromR2(c.env, updated))

    return c.json({
      document: {
        ...docSummaryFromRow(updated),
        content: resolvedBody
      } satisfies DocumentDetail
    })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

documentRoutes.delete("/api/documents/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM document WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) return c.json({ error: "Document not found" }, 404)

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)
  await c.env.DB.prepare(
    "UPDATE document SET deleted_at = ?, is_pinned = 0, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(timestamp, syncSeq, timestamp, id, auth.user.id)
    .run()

  await revokeTargetActiveShares(c.env, "document", id)
  return c.json({ success: true })
})

documentRoutes.post("/api/documents/:id/restore", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM document WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) return c.json({ error: "Document not found in trash" }, 404)

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)
  await c.env.DB.prepare(
    "UPDATE document SET deleted_at = NULL, is_archived = 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(syncSeq, timestamp, id, auth.user.id)
    .run()

  return c.json({ success: true })
})

documentRoutes.delete("/api/documents/:id/permanent", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare("SELECT id, r2_key FROM document WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .first<{ id: string; r2_key: string }>()
  if (!existing) return c.json({ error: "Document not found" }, 404)

  await revokeTargetActiveShares(c.env, "document", id)
  const queueId = await queueR2Deletion(c.env, existing.r2_key, "document_deleted")
  await c.env.DB.prepare("DELETE FROM document WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .run()
  c.executionCtx.waitUntil(tryDeleteQueuedR2Object(c.env, queueId, existing.r2_key))

  return c.json({ success: true })
})
