import { PERMISSIONS } from "@notepad/core"
import { Hono } from "hono"
import { requirePermission, type AppEnv } from "../lib/auth"
import { now } from "../lib/db"

export const syncRoutes = new Hono<AppEnv>()

syncRoutes.get("/api/sync/cursor", async (c) => {
  const auth = requirePermission(c, PERMISSIONS.NOTE_MANAGE)
  const row = await c.env.DB.prepare("SELECT current_seq FROM user_sync_state WHERE user_id = ?")
    .bind(auth.user.id)
    .first<{ current_seq: number }>()

  return c.json({
    currentSeq: row?.current_seq ?? 0,
    serverTime: now()
  })
})
