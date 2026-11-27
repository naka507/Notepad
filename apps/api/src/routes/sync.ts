import {
  PERMISSIONS,
  normalizeBase32Secret,
  syncPushSchema,
  type CategoryScope,
  type SyncCategoryRecord,
  type SyncDocumentRecord,
  type SyncFileRecord,
  type SyncNoteRecord,
  type SyncPullResponse,
  type SyncPushItemResult,
  type SyncPushResponse,
  type TotpAlgorithm
} from "@notepad/core"
import { Hono } from "hono"
import { getTotpEncryptionKey, requirePermission, type AppEnv } from "../lib/auth"
import { encryptSecret } from "../lib/crypto"
import {
  buildNoteExcerpt,
  nextSyncSeq,
  now,
  type CategoryRow,
  type DocumentRow,
  type FileObjectRow,
  type NoteRow,
  type TotpEntryRow
} from "../lib/db"
import { parseJson, zodErrorResponse } from "../lib/http"
import { computeFileAccessSnapshot } from "../lib/quota"
import { totpEntryFromRow } from "./totp"

const VALID_SCOPES = new Set<CategoryScope>(["note", "document", "sheet", "file", "totp"])

export const syncRoutes = new Hono<AppEnv>()

syncRoutes.get("/api/sync/cursor", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const row = await c.env.DB.prepare("SELECT current_seq, min_retained_seq FROM user_sync_state WHERE user_id = ?")
    .bind(auth.user.id)
    .first<{ current_seq: number; min_retained_seq: number }>()

  return c.json({
    currentSeq: row?.current_seq ?? 0,
    minRetainedSeq: row?.min_retained_seq ?? 0,
    serverTime: now()
  })
})

syncRoutes.get("/api/sync/pull", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const sinceSeq = Math.max(0, Number.parseInt(c.req.query("sinceSeq") || "0", 10) || 0)
  const limit = Math.min(200, Math.max(10, Number.parseInt(c.req.query("limit") || "100", 10) || 100))

  const stateRow = await c.env.DB.prepare(
    "SELECT current_seq, min_retained_seq FROM user_sync_state WHERE user_id = ?"
  )
    .bind(auth.user.id)
    .first<{ current_seq: number; min_retained_seq: number }>()

  const currentSeq = stateRow?.current_seq ?? 0
  const minRetainedSeq = stateRow?.min_retained_seq ?? 0
  const fullResyncRequired = sinceSeq > 0 && sinceSeq < minRetainedSeq
  const effectiveSince = fullResyncRequired ? 0 : sinceSeq

  const [catRows, noteRows, docRows, fileRows, totpRows, fileSnapshot] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM category
       WHERE user_id = ? AND sync_seq > ?
       ORDER BY sync_seq ASC
       LIMIT ?`
    )
      .bind(auth.user.id, effectiveSince, limit + 1)
      .all<CategoryRow>(),
    c.env.DB.prepare(
      `SELECT * FROM note
       WHERE user_id = ? AND sync_seq > ?
       ORDER BY sync_seq ASC
       LIMIT ?`
    )
      .bind(auth.user.id, effectiveSince, limit + 1)
      .all<NoteRow>(),
    c.env.DB.prepare(
      `SELECT * FROM document
       WHERE user_id = ? AND sync_seq > ?
       ORDER BY sync_seq ASC
       LIMIT ?`
    )
      .bind(auth.user.id, effectiveSince, limit + 1)
      .all<DocumentRow>(),
    c.env.DB.prepare(
      `SELECT * FROM file_object
       WHERE user_id = ? AND sync_seq > ?
       ORDER BY sync_seq ASC
       LIMIT ?`
    )
      .bind(auth.user.id, effectiveSince, limit + 1)
      .all<FileObjectRow>(),
    c.env.DB.prepare(
      `SELECT * FROM totp_entry
       WHERE user_id = ? AND sync_seq > ?
       ORDER BY sync_seq ASC
       LIMIT ?`
    )
      .bind(auth.user.id, effectiveSince, limit + 1)
      .all<TotpEntryRow>(),
    computeFileAccessSnapshot(c.env, auth.user.id, auth.user.roles)
  ])

  const hasMore =
    catRows.results.length > limit ||
    noteRows.results.length > limit ||
    docRows.results.length > limit ||
    fileRows.results.length > limit ||
    totpRows.results.length > limit

  const categories: SyncCategoryRecord[] = catRows.results.slice(0, limit).map((row) => ({
    id: row.id,
    scope: row.scope,
    parentId: row.parent_id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    version: row.version,
    syncSeq: row.sync_seq,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))

  const notes: SyncNoteRecord[] = noteRows.results.slice(0, limit).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    content: row.content,
    excerpt: row.excerpt,
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    version: row.version,
    syncSeq: row.sync_seq,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))

  const documents: SyncDocumentRecord[] = docRows.results.slice(0, limit).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    docType: row.doc_type,
    title: row.title,
    excerpt: row.excerpt,
    size: row.size,
    isPinned: row.is_pinned === 1,
    isArchived: row.is_archived === 1,
    version: row.version,
    syncSeq: row.sync_seq,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))

  const files: SyncFileRecord[] = fileRows.results.slice(0, limit).map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: row.size,
    sha256: row.sha256,
    accessStatus: fileSnapshot.statusById.get(row.id) ?? "active",
    version: row.version,
    syncSeq: row.sync_seq,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))

  const totpEntries = await Promise.all(
    totpRows.results.slice(0, limit).map((row) => totpEntryFromRow(c.env, row))
  )

  const maxPulledSeq = Math.max(
    effectiveSince,
    ...categories.map((item) => item.syncSeq),
    ...notes.map((item) => item.syncSeq),
    ...documents.map((item) => item.syncSeq),
    ...files.map((item) => item.syncSeq),
    ...totpEntries.map((item) => item.syncSeq)
  )

  const response: SyncPullResponse = {
    fullResyncRequired,
    currentSeq,
    nextSeq: hasMore ? maxPulledSeq : currentSeq,
    hasMore,
    serverTime: now(),
    changes: {
      categories,
      notes,
      documents,
      files,
      totpEntries
    }
  }

  return c.json(response)
})

syncRoutes.post("/api/sync/push", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)

  try {
    const body = await parseJson(c, syncPushSchema)
    const results: SyncPushItemResult[] = []

    for (const op of body.operations) {
      const timestamp = now()

      if (op.entity === "note") {
        const existing = await c.env.DB.prepare("SELECT * FROM note WHERE id = ? AND user_id = ?")
          .bind(op.id, auth.user.id)
          .first<NoteRow>()

        if (op.action === "delete") {
          if (!existing) {
            results.push({ clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: "applied" })
            continue
          }
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          await c.env.DB.prepare(
            "UPDATE note SET deleted_at = ?, is_pinned = 0, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
          )
            .bind(timestamp, syncSeq, timestamp, op.id, auth.user.id)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: existing.version + 1,
            syncSeq
          })
          continue
        }

        const p = op.payload ?? {}
        const title = typeof p.title === "string" ? p.title.slice(0, 200) : existing?.title ?? ""
        const content = typeof p.content === "string" ? p.content.slice(0, 500_000) : existing?.content ?? ""
        const categoryId =
          p.categoryId === null || typeof p.categoryId === "string"
            ? (p.categoryId as string | null)
            : existing?.category_id ?? null
        const isPinned = typeof p.isPinned === "boolean" ? (p.isPinned ? 1 : 0) : existing?.is_pinned ?? 0
        const excerpt = buildNoteExcerpt(content)

        if (!existing) {
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          await c.env.DB.prepare(
            `INSERT INTO note (id, user_id, category_id, title, content, excerpt, is_pinned, is_archived, version, sync_seq, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
          )
            .bind(op.id, auth.user.id, categoryId, title, content, excerpt, isPinned, syncSeq, timestamp, timestamp)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: 1,
            syncSeq
          })
          continue
        }

        if (op.baseVersion !== undefined && op.baseVersion !== null && op.baseVersion !== existing.version) {
          // Preserve offline work in a conflict copy so user data is never lost
          const conflictCopyId = crypto.randomUUID()
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          const conflictTitle = `${title || existing.title || "Untitled"} (Conflict Copy)`.slice(0, 200)
          await c.env.DB.prepare(
            `INSERT INTO note (id, user_id, category_id, title, content, excerpt, is_pinned, is_archived, version, sync_seq, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1, ?, ?, ?)`
          )
            .bind(
              conflictCopyId,
              auth.user.id,
              categoryId,
              conflictTitle,
              content,
              excerpt,
              syncSeq,
              timestamp,
              timestamp
            )
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "conflict",
            version: existing.version,
            syncSeq,
            conflictCopyId
          })
          continue
        }

        const syncSeq = await nextSyncSeq(c.env, auth.user.id)
        await c.env.DB.prepare(
          `UPDATE note
           SET category_id = ?, title = ?, content = ?, excerpt = ?, is_pinned = ?,
               deleted_at = NULL, version = version + 1, sync_seq = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
          .bind(categoryId, title, content, excerpt, isPinned, syncSeq, timestamp, op.id, auth.user.id)
          .run()

        results.push({
          clientOpId: op.clientOpId,
          entity: op.entity,
          id: op.id,
          status: "applied",
          version: existing.version + 1,
          syncSeq
        })
        continue
      }

      if (op.entity === "category") {
        const existing = await c.env.DB.prepare("SELECT * FROM category WHERE id = ? AND user_id = ?")
          .bind(op.id, auth.user.id)
          .first<CategoryRow>()

        if (op.action === "delete") {
          if (!existing) {
            results.push({ clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: "applied" })
            continue
          }
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          await c.env.DB.prepare(
            "UPDATE category SET deleted_at = ?, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
          )
            .bind(timestamp, syncSeq, timestamp, op.id, auth.user.id)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: existing.version + 1,
            syncSeq
          })
          continue
        }

        const p = op.payload ?? {}
        const name = typeof p.name === "string" ? p.name.trim().slice(0, 40) : existing?.name ?? ""
        const rawScope = typeof p.scope === "string" ? (p.scope as CategoryScope) : existing?.scope ?? "note"
        const scope: CategoryScope = VALID_SCOPES.has(rawScope) ? rawScope : "note"
        if (!name || name === "默认" || name.toLowerCase() === "default") {
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "rejected",
            error: "Invalid category name"
          })
          continue
        }

        const syncSeq = await nextSyncSeq(c.env, auth.user.id)
        if (!existing) {
          await c.env.DB.prepare(
            `INSERT INTO category (id, user_id, scope, parent_id, name, icon, color, sort_order, version, sync_seq, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, NULL, NULL, 0, 1, ?, ?, ?)`
          )
            .bind(op.id, auth.user.id, scope, name, syncSeq, timestamp, timestamp)
            .run()
          results.push({ clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: "applied", version: 1, syncSeq })
        } else {
          await c.env.DB.prepare(
            "UPDATE category SET name = ?, deleted_at = NULL, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
          )
            .bind(name, syncSeq, timestamp, op.id, auth.user.id)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: existing.version + 1,
            syncSeq
          })
        }
        continue
      }

      if (op.entity === "totp") {
        const existing = await c.env.DB.prepare("SELECT * FROM totp_entry WHERE id = ? AND user_id = ?")
          .bind(op.id, auth.user.id)
          .first<TotpEntryRow>()

        if (op.action === "delete") {
          if (!existing) {
            results.push({ clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: "applied" })
            continue
          }
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          await c.env.DB.prepare(
            "UPDATE totp_entry SET deleted_at = ?, version = version + 1, sync_seq = ?, updated_at = ? WHERE id = ? AND user_id = ?"
          )
            .bind(timestamp, syncSeq, timestamp, op.id, auth.user.id)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: existing.version + 1,
            syncSeq
          })
          continue
        }

        const p = op.payload ?? {}
        const issuer = typeof p.issuer === "string" ? p.issuer.trim().slice(0, 80) : existing?.issuer ?? ""
        const accountName =
          typeof p.accountName === "string" ? p.accountName.trim().slice(0, 120) : existing?.account_name ?? ""
        const categoryId =
          p.categoryId === null || typeof p.categoryId === "string"
            ? (p.categoryId as string | null)
            : existing?.category_id ?? null

        if (!existing) {
          const rawSecret = typeof p.secret === "string" ? p.secret : ""
          let normalizedSecret: string
          try {
            normalizedSecret = normalizeBase32Secret(rawSecret)
          } catch {
            results.push({
              clientOpId: op.clientOpId,
              entity: op.entity,
              id: op.id,
              status: "rejected",
              error: "Invalid Base32 secret"
            })
            continue
          }
          if (!accountName) {
            results.push({
              clientOpId: op.clientOpId,
              entity: op.entity,
              id: op.id,
              status: "rejected",
              error: "Account name is required"
            })
            continue
          }

          const alg: TotpAlgorithm =
            p.algorithm === "SHA256" || p.algorithm === "SHA512" ? p.algorithm : "SHA1"
          const digits = p.digits === 8 ? 8 : 6
          const period = typeof p.period === "number" && p.period >= 10 && p.period <= 120 ? Math.round(p.period) : 30
          const encrypted = await encryptSecret(normalizedSecret, getTotpEncryptionKey(c.env))
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)

          await c.env.DB.prepare(
            `INSERT INTO totp_entry (
               id, user_id, category_id, issuer, account_name, secret_ciphertext, secret_iv,
               encryption_mode, key_version, algorithm, digits, period, sort_order,
               version, sync_seq, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'server_kms', 1, ?, ?, ?, 0, 1, ?, ?, ?)`
          )
            .bind(
              op.id,
              auth.user.id,
              categoryId,
              issuer,
              accountName,
              encrypted.ciphertext,
              encrypted.iv,
              alg,
              digits,
              period,
              syncSeq,
              timestamp,
              timestamp
            )
            .run()

          results.push({ clientOpId: op.clientOpId, entity: op.entity, id: op.id, status: "applied", version: 1, syncSeq })
        } else {
          const syncSeq = await nextSyncSeq(c.env, auth.user.id)
          await c.env.DB.prepare(
            `UPDATE totp_entry
             SET category_id = ?, issuer = ?, account_name = ?, deleted_at = NULL,
                 version = version + 1, sync_seq = ?, updated_at = ?
             WHERE id = ? AND user_id = ?`
          )
            .bind(categoryId, issuer, accountName || existing.account_name, syncSeq, timestamp, op.id, auth.user.id)
            .run()
          results.push({
            clientOpId: op.clientOpId,
            entity: op.entity,
            id: op.id,
            status: "applied",
            version: existing.version + 1,
            syncSeq
          })
        }
      }
    }

    const seqRow = await c.env.DB.prepare("SELECT current_seq FROM user_sync_state WHERE user_id = ?")
      .bind(auth.user.id)
      .first<{ current_seq: number }>()

    const response: SyncPushResponse = {
      currentSeq: seqRow?.current_seq ?? 0,
      serverTime: now(),
      results
    }
    return c.json(response)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})
