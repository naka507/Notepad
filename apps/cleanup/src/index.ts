export interface CloudflareBindings {
  DB: D1Database
  FILES_BUCKET: R2Bucket
}

const DB_BATCH_SIZE = 50
const R2_BATCH_SIZE = 15
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SHARE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

async function cleanupExpiredSessions(env: CloudflareBindings, timestamp: number): Promise<number> {
  const [webRes, deviceRes] = await Promise.all([
    env.DB.prepare("DELETE FROM session WHERE expires_at < ? LIMIT ?")
      .bind(timestamp, DB_BATCH_SIZE)
      .run(),
    env.DB.prepare(
      "DELETE FROM device_session WHERE (expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)) LIMIT ?"
    )
      .bind(timestamp, timestamp - SHARE_RETENTION_MS, DB_BATCH_SIZE)
      .run()
  ])
  return (webRes.meta.changes ?? 0) + (deviceRes.meta.changes ?? 0)
}

async function cleanupExpiredUploads(env: CloudflareBindings, timestamp: number): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, r2_key, r2_upload_id
     FROM file_upload_session
     WHERE status = 'uploading' AND expires_at < ?
     LIMIT ?`
  )
    .bind(timestamp, R2_BATCH_SIZE)
    .all<{ id: string; r2_key: string; r2_upload_id: string }>()

  if (!rows.results.length) return 0

  const statements: D1PreparedStatement[] = []
  for (const row of rows.results) {
    statements.push(
      env.DB.prepare("UPDATE file_upload_session SET status = 'aborted', updated_at = ? WHERE id = ?").bind(
        timestamp,
        row.id
      ),
      env.DB.prepare(
        `INSERT INTO pending_r2_deletion (id, r2_key, r2_upload_id, reason, attempts, created_at)
         VALUES (?, ?, ?, 'upload_expired', 0, ?)`
      ).bind(crypto.randomUUID(), row.r2_key, row.r2_upload_id, timestamp)
    )
  }

  await env.DB.batch(statements)
  return rows.results.length
}

async function sweepPendingR2Deletions(env: CloudflareBindings): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, r2_key, r2_upload_id
     FROM pending_r2_deletion
     WHERE attempts < 10
     ORDER BY created_at ASC
     LIMIT ?`
  )
    .bind(R2_BATCH_SIZE)
    .all<{ id: string; r2_key: string; r2_upload_id: string | null }>()

  let deleted = 0
  for (const row of rows.results) {
    try {
      if (row.r2_upload_id) {
        const upload = env.FILES_BUCKET.resumeMultipartUpload(row.r2_key, row.r2_upload_id)
        await upload.abort()
      } else {
        await env.FILES_BUCKET.delete(row.r2_key)
      }
      await env.DB.prepare("DELETE FROM pending_r2_deletion WHERE id = ?").bind(row.id).run()
      deleted += 1
    } catch {
      await env.DB.prepare("UPDATE pending_r2_deletion SET attempts = attempts + 1 WHERE id = ?")
        .bind(row.id)
        .run()
    }
  }

  return deleted
}

async function cleanupOldTrashAndShares(env: CloudflareBindings, timestamp: number): Promise<{
  notes: number
  documents: number
  files: number
  totpEntries: number
  shares: number
}> {
  const trashCutoff = timestamp - TRASH_RETENTION_MS
  const shareCutoff = timestamp - SHARE_RETENTION_MS

  const expiredDocs = await env.DB.prepare(
    "SELECT id, r2_key FROM document WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?"
  )
    .bind(trashCutoff, R2_BATCH_SIZE)
    .all<{ id: string; r2_key: string }>()

  if (expiredDocs.results.length) {
    const docBatch: D1PreparedStatement[] = []
    for (const doc of expiredDocs.results) {
      docBatch.push(
        env.DB.prepare(
          `INSERT INTO pending_r2_deletion (id, r2_key, r2_upload_id, reason, attempts, created_at)
           VALUES (?, ?, NULL, 'doc_trash_expired', 0, ?)`
        ).bind(crypto.randomUUID(), doc.r2_key, timestamp),
        env.DB.prepare("DELETE FROM document WHERE id = ?").bind(doc.id)
      )
    }
    await env.DB.batch(docBatch)
  }

  const [notesRes, filesRes, totpRes, sharesRes] = await Promise.all([
    env.DB.prepare("DELETE FROM note WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?")
      .bind(trashCutoff, DB_BATCH_SIZE)
      .run(),
    env.DB.prepare("DELETE FROM file_object WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?")
      .bind(trashCutoff, DB_BATCH_SIZE)
      .run(),
    env.DB.prepare("DELETE FROM totp_entry WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?")
      .bind(trashCutoff, DB_BATCH_SIZE)
      .run(),
    env.DB.prepare(
      `DELETE FROM share_link
       WHERE (revoked_at IS NOT NULL AND revoked_at < ?)
          OR (expires_at IS NOT NULL AND expires_at < ?)
       LIMIT ?`
    )
      .bind(shareCutoff, shareCutoff, DB_BATCH_SIZE)
      .run()
  ])

  return {
    notes: notesRes.meta.changes ?? 0,
    documents: expiredDocs.results.length,
    files: filesRes.meta.changes ?? 0,
    totpEntries: totpRes.meta.changes ?? 0,
    shares: sharesRes.meta.changes ?? 0
  }
}

async function runCleanup(env: CloudflareBindings) {
  const timestamp = Date.now()
  const sessions = await cleanupExpiredSessions(env, timestamp)
  const expiredUploads = await cleanupExpiredUploads(env, timestamp)
  const r2Deleted = await sweepPendingR2Deletions(env)
  const purged = await cleanupOldTrashAndShares(env, timestamp)

  return {
    sessions,
    expiredUploads,
    r2Deleted,
    ...purged
  }
}

export default {
  async scheduled(_event, env): Promise<void> {
    const deleted = await runCleanup(env)
    console.log(JSON.stringify({ level: "info", event: "cleanup", deleted }))
  },

  async fetch(_request, env): Promise<Response> {
    const deleted = await runCleanup(env)
    return Response.json({ deleted })
  }
} satisfies ExportedHandler<CloudflareBindings>
