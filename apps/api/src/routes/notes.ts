import {
  NOTE_PAGE_SIZE,
  PERMISSIONS,
  createNoteSchema,
  decodeCursor,
  encodeCursor,
  updateNoteSchema,
  type NoteDetail,
  type NoteSummary
} from "@notepad/core"
import { Hono } from "hono"
import { requirePermission, type AppEnv } from "../lib/auth"
import {
  buildNoteExcerpt,
  nextSyncSeq,
  now,
  revokeTargetActiveShares,
  type NoteRow
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"

function noteSummaryFromRow(row: NoteRow): NoteSummary {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    excerpt: row.excerpt,
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    version: row.version,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function noteDetailFromRow(row: NoteRow): NoteDetail {
  return {
    ...noteSummaryFromRow(row),
    content: row.content
  }
}

export const noteRoutes = new Hono<AppEnv>()

noteRoutes.get("/api/notes", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const view = c.req.query("view") || "archived"
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

  if (categoryId === "default" || categoryId === "uncategorized") {
    conditions.push("category_id IS NULL")
  } else if (categoryId) {
    conditions.push("category_id = ?")
    binds.push(categoryId)
  }

  if (query) {
    conditions.push("(title LIKE ? OR content LIKE ?)")
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
    c.env.DB.prepare(`SELECT count(*) AS count FROM note WHERE ${countWhere}`)
      .bind(...countBinds)
      .first<{ count: number }>(),
    c.env.DB.prepare(
      `SELECT id, user_id, category_id, title, excerpt, is_pinned, is_archived, version, sync_seq, deleted_at, created_at, updated_at
       FROM note
       WHERE ${conditions.join(" AND ")}
       ORDER BY is_pinned DESC, updated_at DESC, id DESC
       LIMIT ?`
    )
      .bind(...binds, NOTE_PAGE_SIZE + 1)
      .all<NoteRow>()
  ])

  const hasMore = rows.results.length > NOTE_PAGE_SIZE
  const items = rows.results.slice(0, NOTE_PAGE_SIZE).map(noteSummaryFromRow)
  const last = items.at(-1)

  return c.json({
    items,
    total: totalRow?.count ?? 0,
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.updatedAt, id: last.id }) : null
  })
})

noteRoutes.post("/api/notes", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)

  try {
    const payload = await parseJson(c, createNoteSchema)
    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'note' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) {
        return c.json({ error: "Category not found" }, 404)
      }
    }

    const id = crypto.randomUUID()
    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)
    const excerpt = buildNoteExcerpt(payload.content)

    await c.env.DB.prepare(
      `INSERT INTO note (id, user_id, category_id, title, content, excerpt, is_pinned, is_archived, version, sync_seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.user.id,
        payload.categoryId ?? null,
        payload.title,
        payload.content,
        excerpt,
        payload.isPinned ? 1 : 0,
        syncSeq,
        timestamp,
        timestamp
      )
      .run()

    const created = await c.env.DB.prepare("SELECT * FROM note WHERE id = ?").bind(id).first<NoteRow>()
    return c.json({ note: created ? noteDetailFromRow(created) : null }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

noteRoutes.get("/api/notes/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const row = await c.env.DB.prepare("SELECT * FROM note WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .first<NoteRow>()
  if (!row) {
    return c.json({ error: "Note not found" }, 404)
  }

  return c.json({ note: noteDetailFromRow(row) })
})

noteRoutes.patch("/api/notes/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  try {
    const existing = await c.env.DB.prepare("SELECT * FROM note WHERE id = ? AND user_id = ?")
      .bind(id, auth.user.id)
      .first<NoteRow>()
    if (!existing || existing.deleted_at !== null) {
      return c.json({ error: "Note not found" }, 404)
    }

    const payload = await parseJson(c, updateNoteSchema)
    if (payload.baseVersion !== undefined && payload.baseVersion !== existing.version) {
      return c.json(
        {
          error: "Version conflict",
          code: "VERSION_CONFLICT",
          current: noteDetailFromRow(existing)
        },
        409
      )
    }

    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'note' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) {
        return c.json({ error: "Category not found" }, 404)
      }
    }

    const nextTitle = payload.title !== undefined ? payload.title : existing.title
    const nextContent = payload.content !== undefined ? payload.content : existing.content
    const nextExcerpt = payload.content !== undefined ? buildNoteExcerpt(nextContent) : existing.excerpt
    const nextCategoryId = payload.categoryId !== undefined ? payload.categoryId : existing.category_id
    const nextPinned = payload.isPinned !== undefined ? (payload.isPinned ? 1 : 0) : existing.is_pinned
    const nextArchived = payload.isArchived !== undefined ? (payload.isArchived ? 1 : 0) : existing.is_archived

    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `UPDATE note
       SET category_id = ?, title = ?, content = ?, excerpt = ?, is_pinned = ?, is_archived = ?,
           version = version + 1, sync_seq = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        nextCategoryId,
        nextTitle,
        nextContent,
        nextExcerpt,
        nextPinned,
        nextArchived,
        syncSeq,
        timestamp,
        id,
        auth.user.id
      )
      .run()

    const updated = await c.env.DB.prepare("SELECT * FROM note WHERE id = ?").bind(id).first<NoteRow>()
    return c.json({ note: updated ? noteDetailFromRow(updated) : null })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

noteRoutes.delete("/api/notes/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM note WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) {
    return c.json({ error: "Note not found" }, 404)
  }

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  await c.env.DB.prepare(
    "UPDATE note SET deleted_at = ?, is_pinned = 0, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(timestamp, syncSeq, timestamp, id, auth.user.id)
    .run()

  await revokeTargetActiveShares(c.env, "note", id)
  return c.json({ success: true })
})

noteRoutes.post("/api/notes/:id/restore", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM note WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) {
    return c.json({ error: "Note not found in trash" }, 404)
  }

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  await c.env.DB.prepare(
    "UPDATE note SET deleted_at = NULL, is_archived = 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(syncSeq, timestamp, id, auth.user.id)
    .run()

  return c.json({ success: true })
})

noteRoutes.delete("/api/notes/:id/permanent", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare("SELECT id FROM note WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) {
    return c.json({ error: "Note not found" }, 404)
  }

  await revokeTargetActiveShares(c.env, "note", id)
  await c.env.DB.prepare("DELETE FROM note WHERE id = ? AND user_id = ?").bind(id, auth.user.id).run()
  return c.json({ success: true })
})
