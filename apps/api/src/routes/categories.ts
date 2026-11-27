import {
  PERMISSIONS,
  createCategorySchema,
  updateCategorySchema,
  type Category,
  type CategoryScope
} from "@notepad/core"
import { Hono } from "hono"
import { requirePermission, type AppEnv } from "../lib/auth"
import { nextSyncSeq, now, type CategoryRow } from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"

const RESERVED_CATEGORY_NAMES = new Set(["默认", "default"])

function isReservedCategoryName(name: string): boolean {
  return RESERVED_CATEGORY_NAMES.has(name.trim().toLowerCase())
}

function parseScope(raw: string | undefined): CategoryScope | null {
  if (raw === "note" || raw === "document" || raw === "sheet" || raw === "file" || raw === "totp") return raw
  return null
}

function categoryFromRow(
  row: CategoryRow & {
    item_count?: number
    note_count?: number
    doc_count?: number
    sheet_count?: number
    file_count?: number
    totp_count?: number
  }
): Category {
  return {
    id: row.id,
    scope: row.scope,
    parentId: row.parent_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    ...(row.item_count !== undefined ? { itemCount: row.item_count } : {}),
    ...(row.note_count !== undefined ? { noteCount: row.note_count } : {}),
    ...(row.doc_count !== undefined ? { docCount: row.doc_count } : {}),
    ...(row.sheet_count !== undefined ? { sheetCount: row.sheet_count } : {}),
    ...(row.file_count !== undefined ? { fileCount: row.file_count } : {}),
    ...(row.totp_count !== undefined ? { totpCount: row.totp_count } : {}),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export const categoryRoutes = new Hono<AppEnv>()

categoryRoutes.get("/api/categories", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const scope = parseScope(c.req.query("scope"))

  if (scope) {
    const countExpr =
      scope === "note"
        ? "(SELECT count(*) FROM note n WHERE n.user_id = c.user_id AND n.category_id = c.id AND n.deleted_at IS NULL)"
        : scope === "document"
          ? "(SELECT count(*) FROM document d WHERE d.user_id = c.user_id AND d.doc_type = 'doc' AND d.category_id = c.id AND d.deleted_at IS NULL)"
          : scope === "sheet"
            ? "(SELECT count(*) FROM document d WHERE d.user_id = c.user_id AND d.doc_type = 'sheet' AND d.category_id = c.id AND d.deleted_at IS NULL)"
            : scope === "totp"
              ? "(SELECT count(*) FROM totp_entry t WHERE t.user_id = c.user_id AND t.category_id = c.id AND t.deleted_at IS NULL)"
              : "(SELECT count(*) FROM file_object f WHERE f.user_id = c.user_id AND f.category_id = c.id AND f.deleted_at IS NULL)"

    const defaultCountSql =
      scope === "note"
        ? "SELECT count(*) AS count FROM note WHERE user_id = ? AND category_id IS NULL AND deleted_at IS NULL"
        : scope === "document"
          ? "SELECT count(*) AS count FROM document WHERE user_id = ? AND doc_type = 'doc' AND category_id IS NULL AND deleted_at IS NULL"
          : scope === "sheet"
            ? "SELECT count(*) AS count FROM document WHERE user_id = ? AND doc_type = 'sheet' AND category_id IS NULL AND deleted_at IS NULL"
            : scope === "totp"
              ? "SELECT count(*) AS count FROM totp_entry WHERE user_id = ? AND category_id IS NULL AND deleted_at IS NULL"
              : "SELECT count(*) AS count FROM file_object WHERE user_id = ? AND category_id IS NULL AND deleted_at IS NULL"

    const [rows, defaultRow] = await Promise.all([
      c.env.DB.prepare(
        `SELECT c.*, ${countExpr} AS item_count
         FROM category c
         WHERE c.user_id = ? AND c.scope = ? AND c.deleted_at IS NULL
         ORDER BY c.sort_order ASC, c.created_at ASC`
      )
        .bind(auth.user.id, scope)
        .all<CategoryRow & { item_count: number }>(),
      c.env.DB.prepare(defaultCountSql).bind(auth.user.id).first<{ count: number }>()
    ])

    return c.json({
      categories: rows.results.map(categoryFromRow),
      defaultCount: defaultRow?.count ?? 0
    })
  }

  const rows = await c.env.DB.prepare(
    `SELECT c.*,
            (SELECT count(*) FROM note n WHERE n.user_id = c.user_id AND n.category_id = c.id AND n.deleted_at IS NULL) AS note_count,
            (SELECT count(*) FROM document d WHERE d.user_id = c.user_id AND d.doc_type = 'doc' AND d.category_id = c.id AND d.deleted_at IS NULL) AS doc_count,
            (SELECT count(*) FROM document d WHERE d.user_id = c.user_id AND d.doc_type = 'sheet' AND d.category_id = c.id AND d.deleted_at IS NULL) AS sheet_count,
            (SELECT count(*) FROM file_object f WHERE f.user_id = c.user_id AND f.category_id = c.id AND f.deleted_at IS NULL) AS file_count,
            (SELECT count(*) FROM totp_entry t WHERE t.user_id = c.user_id AND t.category_id = c.id AND t.deleted_at IS NULL) AS totp_count
     FROM category c
     WHERE c.user_id = ? AND c.deleted_at IS NULL
     ORDER BY c.scope ASC, c.sort_order ASC, c.created_at ASC`
  )
    .bind(auth.user.id)
    .all<
      CategoryRow & {
        note_count: number
        doc_count: number
        sheet_count: number
        file_count: number
        totp_count: number
      }
    >()

  return c.json({
    categories: rows.results.map(categoryFromRow),
    defaultCount: 0
  })
})

categoryRoutes.post("/api/categories", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)

  try {
    const payload = await parseJson(c, createCategorySchema)
    if (isReservedCategoryName(payload.name)) {
      return c.json({ error: "Default category name is reserved" }, 400)
    }

    const duplicate = await c.env.DB.prepare(
      "SELECT 1 FROM category WHERE user_id = ? AND scope = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?)"
    )
      .bind(auth.user.id, payload.scope, payload.name)
      .first()
    if (duplicate) {
      return c.json({ error: "Category name already exists" }, 409)
    }

    const id = crypto.randomUUID()
    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `INSERT INTO category (id, user_id, scope, parent_id, name, icon, color, sort_order, version, sync_seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.user.id,
        payload.scope,
        payload.parentId ?? null,
        payload.name,
        payload.icon ?? null,
        payload.color ?? null,
        payload.sortOrder ?? 0,
        syncSeq,
        timestamp,
        timestamp
      )
      .run()

    const created = await c.env.DB.prepare("SELECT * FROM category WHERE id = ?")
      .bind(id)
      .first<CategoryRow>()

    return c.json({ category: created ? categoryFromRow(created) : null }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

categoryRoutes.patch("/api/categories/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  try {
    const existing = await c.env.DB.prepare(
      "SELECT * FROM category WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
    )
      .bind(id, auth.user.id)
      .first<CategoryRow>()
    if (!existing) {
      return c.json({ error: "Category not found" }, 404)
    }

    const payload = await parseJson(c, updateCategorySchema)
    const nextName = payload.name ?? existing.name
    if (payload.name) {
      if (isReservedCategoryName(payload.name)) {
        return c.json({ error: "Default category name is reserved" }, 400)
      }
      if (payload.name.toLowerCase() !== existing.name.toLowerCase()) {
        const duplicate = await c.env.DB.prepare(
          "SELECT 1 FROM category WHERE user_id = ? AND scope = ? AND deleted_at IS NULL AND LOWER(name) = LOWER(?) AND id != ?"
        )
          .bind(auth.user.id, existing.scope, nextName, id)
          .first()
        if (duplicate) {
          return c.json({ error: "Category name already exists" }, 409)
        }
      }
    }

    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `UPDATE category
       SET name = ?, parent_id = ?, icon = ?, color = ?, sort_order = ?, version = version + 1, sync_seq = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        nextName,
        payload.parentId !== undefined ? payload.parentId : existing.parent_id,
        payload.icon !== undefined ? payload.icon : existing.icon,
        payload.color !== undefined ? payload.color : existing.color,
        payload.sortOrder !== undefined ? payload.sortOrder : existing.sort_order,
        syncSeq,
        timestamp,
        id,
        auth.user.id
      )
      .run()

    const updated = await c.env.DB.prepare("SELECT * FROM category WHERE id = ?")
      .bind(id)
      .first<CategoryRow>()

    return c.json({ category: updated ? categoryFromRow(updated) : null })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

categoryRoutes.delete("/api/categories/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id, scope FROM category WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string; scope: CategoryScope }>()
  if (!existing) {
    return c.json({ error: "Category not found" }, 404)
  }

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  const resetStatement =
    existing.scope === "note"
      ? c.env.DB.prepare("UPDATE note SET category_id = NULL, updated_at = ? WHERE user_id = ? AND category_id = ?")
      : existing.scope === "document"
        ? c.env.DB.prepare(
            "UPDATE document SET category_id = NULL, updated_at = ? WHERE user_id = ? AND doc_type = 'doc' AND category_id = ?"
          )
        : existing.scope === "sheet"
          ? c.env.DB.prepare(
              "UPDATE document SET category_id = NULL, updated_at = ? WHERE user_id = ? AND doc_type = 'sheet' AND category_id = ?"
            )
          : existing.scope === "totp"
            ? c.env.DB.prepare(
                "UPDATE totp_entry SET category_id = NULL, updated_at = ? WHERE user_id = ? AND category_id = ?"
              )
            : c.env.DB.prepare(
                "UPDATE file_object SET category_id = NULL, updated_at = ? WHERE user_id = ? AND category_id = ?"
              )

  await c.env.DB.batch([
    resetStatement.bind(timestamp, auth.user.id, id),
    c.env.DB.prepare(
      "UPDATE category SET deleted_at = ?, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(timestamp, syncSeq, timestamp, id, auth.user.id)
  ])

  return c.json({ success: true })
})
