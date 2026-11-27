import {
  PERMISSIONS,
  createTotpSchema,
  importTotpUrisSchema,
  normalizeBase32Secret,
  parseOtpAuthUri,
  updateTotpSchema,
  type TotpEntry
} from "@notepad/core"
import { Hono } from "hono"
import { getTotpEncryptionKey, requirePermission, type AppEnv } from "../lib/auth"
import { decryptSecret, encryptSecret } from "../lib/crypto"
import { nextSyncSeq, now, type TotpEntryRow } from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"

export async function totpEntryFromRow(
  env: AppEnv["Bindings"],
  row: TotpEntryRow
): Promise<TotpEntry> {
  const secret = await decryptSecret(row.secret_ciphertext, row.secret_iv, getTotpEncryptionKey(env))
  return {
    id: row.id,
    categoryId: row.category_id,
    issuer: row.issuer,
    accountName: row.account_name,
    secret,
    algorithm: row.algorithm,
    digits: row.digits === 8 ? 8 : 6,
    period: row.period,
    sortOrder: row.sort_order,
    version: row.version,
    syncSeq: row.sync_seq,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export const totpRoutes = new Hono<AppEnv>()

totpRoutes.get("/api/totp", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)
  const view = c.req.query("view") || "archived"
  const categoryId = c.req.query("categoryId")
  const query = c.req.query("q")?.trim()

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
    conditions.push("(issuer LIKE ? OR account_name LIKE ?)")
    const pattern = `%${query}%`
    binds.push(pattern, pattern)
  }

  const rows = await c.env.DB.prepare(
    `SELECT *
     FROM totp_entry
     WHERE ${conditions.join(" AND ")}
     ORDER BY sort_order ASC, updated_at DESC, id DESC
     LIMIT 200`
  )
    .bind(...binds)
    .all<TotpEntryRow>()

  const items = await Promise.all(rows.results.map((row) => totpEntryFromRow(c.env, row)))
  return c.json({ items, total: items.length })
})

totpRoutes.post("/api/totp", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)

  try {
    const payload = await parseJson(c, createTotpSchema)
    let normalizedSecret: string
    try {
      normalizedSecret = normalizeBase32Secret(payload.secret)
    } catch {
      return c.json({ error: "Invalid Base32 secret key" }, 400)
    }

    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'totp' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) return c.json({ error: "Category not found" }, 404)
    }

    const encrypted = await encryptSecret(normalizedSecret, getTotpEncryptionKey(c.env))
    const id = crypto.randomUUID()
    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `INSERT INTO totp_entry (
         id, user_id, category_id, issuer, account_name, secret_ciphertext, secret_iv,
         encryption_mode, key_version, algorithm, digits, period, sort_order,
         version, sync_seq, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'server_kms', 1, ?, ?, ?, ?, 1, ?, ?, ?)`
    )
      .bind(
        id,
        auth.user.id,
        payload.categoryId ?? null,
        payload.issuer,
        payload.accountName,
        encrypted.ciphertext,
        encrypted.iv,
        payload.algorithm,
        payload.digits,
        payload.period,
        payload.sortOrder,
        syncSeq,
        timestamp,
        timestamp
      )
      .run()

    const created = await c.env.DB.prepare("SELECT * FROM totp_entry WHERE id = ?")
      .bind(id)
      .first<TotpEntryRow>()

    return c.json({ entry: created ? await totpEntryFromRow(c.env, created) : null }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

totpRoutes.post("/api/totp/import", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)

  try {
    const payload = await parseJson(c, importTotpUrisSchema)
    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'totp' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) return c.json({ error: "Category not found" }, 404)
    }

    const imported: TotpEntry[] = []
    let skipped = 0
    const key = getTotpEncryptionKey(c.env)

    for (const uri of payload.uris) {
      const parsed = parseOtpAuthUri(uri)
      if (!parsed) {
        skipped += 1
        continue
      }

      const encrypted = await encryptSecret(parsed.secret, key)
      const id = crypto.randomUUID()
      const timestamp = now()
      const syncSeq = await nextSyncSeq(c.env, auth.user.id)

      await c.env.DB.prepare(
        `INSERT INTO totp_entry (
           id, user_id, category_id, issuer, account_name, secret_ciphertext, secret_iv,
           encryption_mode, key_version, algorithm, digits, period, sort_order,
           version, sync_seq, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'server_kms', 1, ?, ?, ?, 0, 1, ?, ?, ?)`
      )
        .bind(
          id,
          auth.user.id,
          payload.categoryId ?? null,
          parsed.issuer,
          parsed.accountName,
          encrypted.ciphertext,
          encrypted.iv,
          parsed.algorithm,
          parsed.digits,
          parsed.period,
          syncSeq,
          timestamp,
          timestamp
        )
        .run()

      imported.push({
        id,
        categoryId: payload.categoryId ?? null,
        issuer: parsed.issuer,
        accountName: parsed.accountName,
        secret: parsed.secret,
        algorithm: parsed.algorithm,
        digits: parsed.digits,
        period: parsed.period,
        sortOrder: 0,
        version: 1,
        syncSeq,
        deletedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp
      })
    }

    if (!imported.length) {
      return c.json({ error: "No valid otpauth://totp/ URIs found" }, 400)
    }

    return c.json({ imported, skipped }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

totpRoutes.patch("/api/totp/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)
  const id = c.req.param("id")

  try {
    const existing = await c.env.DB.prepare("SELECT * FROM totp_entry WHERE id = ? AND user_id = ?")
      .bind(id, auth.user.id)
      .first<TotpEntryRow>()
    if (!existing || existing.deleted_at !== null) {
      return c.json({ error: "2FA entry not found" }, 404)
    }

    const payload = await parseJson(c, updateTotpSchema)
    if (payload.baseVersion !== undefined && payload.baseVersion !== existing.version) {
      return c.json(
        {
          error: "Version conflict",
          code: "VERSION_CONFLICT",
          current: await totpEntryFromRow(c.env, existing)
        },
        409
      )
    }

    if (payload.categoryId) {
      const cat = await c.env.DB.prepare(
        "SELECT id FROM category WHERE id = ? AND user_id = ? AND scope = 'totp' AND deleted_at IS NULL"
      )
        .bind(payload.categoryId, auth.user.id)
        .first()
      if (!cat) return c.json({ error: "Category not found" }, 404)
    }

    const timestamp = now()
    const syncSeq = await nextSyncSeq(c.env, auth.user.id)

    await c.env.DB.prepare(
      `UPDATE totp_entry
       SET category_id = ?, issuer = ?, account_name = ?, sort_order = ?,
           version = version + 1, sync_seq = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        payload.categoryId !== undefined ? payload.categoryId : existing.category_id,
        payload.issuer !== undefined ? payload.issuer : existing.issuer,
        payload.accountName !== undefined ? payload.accountName : existing.account_name,
        payload.sortOrder !== undefined ? payload.sortOrder : existing.sort_order,
        syncSeq,
        timestamp,
        id,
        auth.user.id
      )
      .run()

    const updated = await c.env.DB.prepare("SELECT * FROM totp_entry WHERE id = ?")
      .bind(id)
      .first<TotpEntryRow>()

    return c.json({ entry: updated ? await totpEntryFromRow(c.env, updated) : null })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

totpRoutes.delete("/api/totp/:id", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM totp_entry WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) return c.json({ error: "2FA entry not found" }, 404)

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  await c.env.DB.prepare(
    "UPDATE totp_entry SET deleted_at = ?, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(timestamp, syncSeq, timestamp, id, auth.user.id)
    .run()

  return c.json({ success: true })
})

totpRoutes.post("/api/totp/:id/restore", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare(
    "SELECT id FROM totp_entry WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL"
  )
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) return c.json({ error: "2FA entry not found in trash" }, 404)

  const timestamp = now()
  const syncSeq = await nextSyncSeq(c.env, auth.user.id)

  await c.env.DB.prepare(
    "UPDATE totp_entry SET deleted_at = NULL, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(syncSeq, timestamp, id, auth.user.id)
    .run()

  return c.json({ success: true })
})

totpRoutes.delete("/api/totp/:id/permanent", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.TOTP_MANAGE)
  const id = c.req.param("id")

  const existing = await c.env.DB.prepare("SELECT id FROM totp_entry WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .first<{ id: string }>()
  if (!existing) return c.json({ error: "2FA entry not found" }, 404)

  await c.env.DB.prepare("DELETE FROM totp_entry WHERE id = ? AND user_id = ?")
    .bind(id, auth.user.id)
    .run()

  return c.json({ success: true })
})
