import { SESSION_COOKIE_NAME, SITE_CONFIG_KV_KEY } from "@notepad/core"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { HTTPException } from "hono/http-exception"
import { authMiddleware, type AppEnv } from "./lib/auth"
import { adminRoutes } from "./routes/admin"
import { authRoutes } from "./routes/auth"
import { categoryRoutes } from "./routes/categories"
import { documentRoutes } from "./routes/documents"
import { fileRoutes } from "./routes/files"
import { noteRoutes } from "./routes/notes"
import { shareRoutes } from "./routes/shares"
import { syncRoutes } from "./routes/sync"
import { totpRoutes } from "./routes/totp"

const app = new Hono<AppEnv>()

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-File-Name",
      "X-File-Mime",
      "X-File-Size",
      "X-File-Category",
      "X-File-Sha256"
    ],
    exposeHeaders: ["Content-Disposition", "Content-Range", "ETag"],
    maxAge: 86400
  })
)

app.use("/api/*", authMiddleware)

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status)
  }

  console.error(
    JSON.stringify({
      level: "error",
      event: "api_error",
      message: error instanceof Error ? error.message : String(error)
    })
  )
  return c.json({ error: "Internal server error" }, 500)
})

app.notFound((c) => c.json({ error: "Not found" }, 404))

app.get("/api/health", async (c) => {
  const database = await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>()
  await c.env.SITE_CONFIG.get(SITE_CONFIG_KV_KEY)
  const r2Ready = Boolean(c.env.FILES_BUCKET)

  return c.json({
    status: "ok",
    time: new Date().toISOString(),
    checks: {
      database: database?.ok === 1,
      siteConfig: true,
      storage: r2Ready
    }
  })
})

app.route("/", authRoutes)
app.route("/", categoryRoutes)
app.route("/", noteRoutes)
app.route("/", documentRoutes)
app.route("/", fileRoutes)
app.route("/", shareRoutes)
app.route("/", totpRoutes)
app.route("/", adminRoutes)
app.route("/", syncRoutes)

app.get("/api/openapi.json", (c) =>
  c.json({
    openapi: "3.1.0",
    info: {
      title: "Notepad API",
      version: "1.0.1",
      description: "Cloudflare-native personal memo, small file vault, custom categories, and timed anonymous sharing API."
    },
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: SESSION_COOKIE_NAME
        }
      }
    },
    paths: {
      "/api/health": { get: { summary: "Health check" } },
      "/api/session": { get: { summary: "Current authenticated session" } },
      "/api/auth/register": { post: { summary: "Register (first user atomically becomes admin)" } },
      "/api/auth/login": { post: { summary: "Login with username/password" } },
      "/api/auth/logout": { post: { summary: "Logout session" } },
      "/api/auth/token/refresh": { post: { summary: "Rotate native client refresh token" } },
      "/api/auth/oauth/exchange": { post: { summary: "Exchange native OAuth callback code for tokens" } },
      "/api/auth/devices": { get: { summary: "List active web and device sessions" } },
      "/api/auth/devices/{id}": { delete: { summary: "Revoke a web or device session" } },
      "/api/auth/github/start": { get: { summary: "Start GitHub OAuth login/register" } },
      "/api/auth/github/bind/start": { get: { summary: "Start GitHub OAuth account binding" } },
      "/api/auth/github/bind": { delete: { summary: "Unlink GitHub account" } },
      "/api/auth/password/set": { post: { summary: "Set password for GitHub-registered user" } },
      "/api/auth/password/change": { post: { summary: "Change existing password" } },
      "/api/categories": { get: { summary: "List categories" }, post: { summary: "Create category" } },
      "/api/notes": { get: { summary: "List notes" }, post: { summary: "Create note" } },
      "/api/notes/{id}": { get: { summary: "Get note" }, patch: { summary: "Update note" }, delete: { summary: "Move note to trash" } },
      "/api/files": { get: { summary: "List files with real-time lock status & quota" } },
      "/api/files/upload": { post: { summary: "Streaming upload <= 5MB" } },
      "/api/files/multipart/init": { post: { summary: "Initialize R2 multipart upload" } },
      "/api/files/{id}/content": { get: { summary: "Stream file content with Range & downgrade lock enforcement" } },
      "/api/shares": { get: { summary: "List shares" }, post: { summary: "Create timed anonymous share" } },
      "/api/public/shares/{code}": { get: { summary: "Anonymous share view" } },
      "/api/public/shares/{code}/download": { get: { summary: "Anonymous share download" } },
      "/api/sync/cursor": { get: { summary: "Lightweight sync cursor probe" } },
      "/api/sync/pull": { get: { summary: "Incremental multi-device sync pull" } },
      "/api/sync/push": { post: { summary: "Idempotent multi-device sync push with conflict copies" } },
      "/api/totp": { get: { summary: "List decrypted 2FA TOTP entries" }, post: { summary: "Create encrypted 2FA TOTP entry" } },
      "/api/totp/import": { post: { summary: "Batch import otpauth:// URIs" } },
      "/api/admin/users": { get: { summary: "List users for authorization" } },
      "/api/admin/storage-stats": { get: { summary: "Global Cloudflare R2 Free Tier usage stats" } },
      "/api/config": { get: { summary: "Get site config" }, put: { summary: "Update site config" } }
    }
  })
)

export default app
