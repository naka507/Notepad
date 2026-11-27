import {
  OAUTH_STATE_COOKIE_NAME,
  PERMISSIONS,
  SESSION_COOKIE_NAME,
  hasPermission,
  permissionsForRoles,
  primaryRoleFromRoles,
  type Permission,
  type Role,
  type UserSummary
} from "@notepad/core"
import type { Context, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import type { CloudflareBindings } from "../env"
import { getSiteConfig } from "./config"
import { parseCookies, serializeCookie } from "./cookies"
import { randomToken, sha256 } from "./crypto"
import { getLinkedAccounts, getUserById, getUserRoles, type UserRow } from "./db"
import { computeFileAccessSnapshot } from "./quota"

export interface AuthContext {
  user: UserSummary
  rawUser: UserRow
}

export interface AppVariables {
  auth: AuthContext | null
}

export type AppEnv = {
  Bindings: CloudflareBindings
  Variables: AppVariables
}

export function getSigningSecret(env: CloudflareBindings): string {
  return env.TOKEN_SIGNING_SECRET || env.GITHUB_CLIENT_SECRET || "notepad-dev-signing-secret"
}

export function getAppUrl(c: Context<AppEnv>): string {
  return c.env.APP_URL || new URL(c.req.url).origin
}

export function cookieSecure(c: Context<AppEnv>): boolean {
  return c.req.url.startsWith("https://")
}

export async function buildUserSummary(
  env: CloudflareBindings,
  row: UserRow,
  roles: Role[]
): Promise<UserSummary> {
  const [linkedAccounts, snapshot] = await Promise.all([
    getLinkedAccounts(env, row.id),
    computeFileAccessSnapshot(env, row.id, roles)
  ])

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: primaryRoleFromRoles(roles),
    roles,
    permissions: permissionsForRoles(roles),
    hasPassword: Boolean(row.password_hash && row.password_salt),
    linkedAccounts,
    quota: snapshot.quota
  }
}

async function authFromSession(env: CloudflareBindings, token: string): Promise<AuthContext | null> {
  const tokenHash = await sha256(token)
  const session = await env.DB.prepare(
    `SELECT user_id
     FROM session
     WHERE token_hash = ? AND expires_at > ?`
  )
    .bind(tokenHash, Date.now())
    .first<{ user_id: string }>()

  if (!session) return null

  const user = await getUserById(env, session.user_id)
  if (!user || user.disabled_at !== null) return null

  const roles = await getUserRoles(env, user.id)
  const summary = await buildUserSummary(env, user, roles)
  return { user: summary, rawUser: user }
}

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path === "/api/health" || path.startsWith("/api/public/")) {
    c.set("auth", null)
    await next()
    return
  }

  const cookies = parseCookies(c.req.header("Cookie") ?? null)
  const sessionToken = cookies.get(SESSION_COOKIE_NAME)
  c.set("auth", sessionToken ? await authFromSession(c.env, sessionToken) : null)
  await next()
}

export function requireAuth(c: Context<AppEnv>): AuthContext {
  const auth = c.get("auth")
  if (!auth) {
    throw new HTTPException(401, { message: "Unauthorized" })
  }
  return auth
}

export function requirePermission(c: Context<AppEnv>, permission: Permission): AuthContext {
  const auth = requireAuth(c)
  if (!hasPermission(auth.user.roles, permission)) {
    throw new HTTPException(403, { message: "Forbidden" })
  }
  return auth
}

export function canManageConfig(roles: Role[]): boolean {
  return hasPermission(roles, PERMISSIONS.CONFIG_MANAGE)
}

export async function createSession(
  env: CloudflareBindings,
  userId: string,
  meta?: { userAgent?: string | null; ipAddress?: string | null }
): Promise<string> {
  const token = randomToken(32)
  const tokenHash = await sha256(token)
  const timestamp = Date.now()
  const expiresAt = timestamp + 30 * 24 * 60 * 60 * 1000

  await env.DB.prepare(
    `INSERT INTO session (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      userId,
      tokenHash,
      meta?.userAgent ?? null,
      meta?.ipAddress ?? null,
      expiresAt,
      timestamp
    )
    .run()

  return token
}

export async function deleteSession(env: CloudflareBindings, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM session WHERE token_hash = ?").bind(await sha256(token)).run()
}

export function sessionCookie(token: string, requestUrl: string): string {
  return serializeCookie(SESSION_COOKIE_NAME, token, {
    maxAge: 30 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: "Lax",
    secure: requestUrl.startsWith("https://"),
    path: "/"
  })
}

export function oauthStateCookie(state: string, requestUrl: string): string {
  return serializeCookie(OAUTH_STATE_COOKIE_NAME, state, {
    maxAge: 10 * 60,
    httpOnly: true,
    sameSite: "Lax",
    secure: requestUrl.startsWith("https://"),
    path: "/"
  })
}

export async function verifyTurnstileIfEnabled(
  env: CloudflareBindings,
  token: string | undefined,
  remoteIp: string | null
): Promise<void> {
  const config = await getSiteConfig(env, true)
  if (!config.turnstile.enabled) return
  if (!token) throw new HTTPException(400, { message: "Turnstile token required" })
  if (!config.turnstile.secretKey) throw new HTTPException(500, { message: "Turnstile is not configured" })

  const form = new FormData()
  form.set("secret", config.turnstile.secretKey)
  form.set("response", token)
  if (remoteIp) form.set("remoteip", remoteIp)

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form
  })
  const payload = (await response.json()) as { success?: boolean }
  if (payload?.success !== true) {
    throw new HTTPException(400, { message: "Turnstile verification failed" })
  }
}
