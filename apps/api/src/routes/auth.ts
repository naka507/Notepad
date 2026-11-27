import {
  OAUTH_STATE_COOKIE_NAME,
  ROLES,
  SESSION_COOKIE_NAME,
  changePasswordSchema,
  loginSchema,
  oauthExchangeSchema,
  refreshTokenSchema,
  registerSchema,
  setPasswordSchema,
  type ClientType,
  type DeviceSessionSummary
} from "@notepad/core"
import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import {
  buildUserSummary,
  cookieSecure,
  createSession,
  deleteSession,
  getAppUrl,
  getSigningSecret,
  issueNativeDeviceTokens,
  oauthStateCookie,
  requireAuth,
  rotateNativeRefreshToken,
  sessionCookie,
  verifyTurnstileIfEnabled,
  type AppEnv
} from "../lib/auth"
import { getSiteConfig } from "../lib/config"
import { expiredCookie, parseCookies } from "../lib/cookies"
import { hashPassword, randomToken, sha256, signPayload, verifyPassword, verifySignedPayload } from "../lib/crypto"
import {
  createUserWithAtomicBootstrap,
  getUserById,
  getUserRoles,
  now,
  type DeviceSessionRow,
  type UserRow,
  type WebSessionRow
} from "../lib/db"
import { isRecord, parseJson, zodErrorResponse } from "../lib/http"

interface OAuthStatePayload extends Record<string, unknown> {
  intent: "login" | "bind"
  client?: ClientType
  userId?: string
  nonce: string
  exp: number
}

interface OAuthExchangePayload extends Record<string, unknown> {
  typ: "oauth_exchange"
  userId: string
  client: "desktop" | "mobile"
  nonce: string
  exp: number
}

function summarizeUserAgent(ua: string | null): { deviceName: string; platform: string } {
  if (!ua) return { deviceName: "Web Browser", platform: "web" }
  const lower = ua.toLowerCase()
  const browser = lower.includes("edg/")
    ? "Edge"
    : lower.includes("chrome/")
      ? "Chrome"
      : lower.includes("firefox/")
        ? "Firefox"
        : lower.includes("safari/")
          ? "Safari"
          : "Browser"
  const os = lower.includes("windows")
    ? "Windows"
    : lower.includes("mac os")
      ? "macOS"
      : lower.includes("android")
        ? "Android"
        : lower.includes("iphone") || lower.includes("ipad")
          ? "iOS"
          : lower.includes("linux")
            ? "Linux"
            : "Web"
  return { deviceName: `${browser} · ${os}`, platform: "web" }
}

async function uniqueGithubUsername(env: AppEnv["Bindings"], login: string): Promise<string> {
  const base =
    login
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || "github"
  let candidate = base.length >= 3 ? base : `${base}_gh`
  let suffix = 0

  while (await env.DB.prepare("SELECT 1 FROM user WHERE username = ?").bind(candidate).first()) {
    suffix += 1
    candidate = `${base}_${suffix}`.slice(0, 32)
  }

  return candidate
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.get("/api/session", (c) => {
  const auth = c.get("auth")
  return c.json({ user: auth?.user ?? null })
})

authRoutes.post("/api/auth/register", async (c) => {
  try {
    const payload = await parseJson(c, registerSchema)
    await verifyTurnstileIfEnabled(
      c.env,
      payload.turnstileToken,
      c.req.header("CF-Connecting-IP") ?? null,
      "register"
    )

    const existing = await c.env.DB.prepare("SELECT 1 FROM user WHERE username = ?")
      .bind(payload.username)
      .first()
    if (existing) {
      return c.json({ error: "Username already exists" }, 409)
    }

    const password = await hashPassword(payload.password)
    const { user, assignedRole } = await createUserWithAtomicBootstrap(c.env, {
      username: payload.username,
      email: null,
      name: payload.username,
      avatarUrl: null,
      passwordHash: password.hash,
      passwordSalt: password.salt
    })

    const summary = await buildUserSummary(c.env, user, [assignedRole])

    if (payload.client !== "web") {
      const tokens = await issueNativeDeviceTokens(c.env, user.id, {
        deviceId: payload.deviceId,
        deviceName: payload.deviceName ?? (payload.client === "mobile" ? "Mobile App" : "Desktop App"),
        platform: payload.platform ?? payload.client
      })
      return c.json({ user: summary, tokens }, 201)
    }

    const token = await createSession(c.env, user.id, {
      userAgent: c.req.header("User-Agent") ?? null,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null
    })

    c.header("Set-Cookie", sessionCookie(token, c.req.url))
    return c.json({ user: summary }, 201)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

authRoutes.post("/api/auth/login", async (c) => {
  try {
    const payload = await parseJson(c, loginSchema)
    if (payload.client === "web") {
      await verifyTurnstileIfEnabled(
        c.env,
        payload.turnstileToken,
        c.req.header("CF-Connecting-IP") ?? null,
        "login"
      )
    }

    const user = await c.env.DB.prepare("SELECT * FROM user WHERE username = ?")
      .bind(payload.username)
      .first<UserRow>()

    if (!user?.password_hash || !user.password_salt) {
      return c.json({ error: "Invalid username or password" }, 401)
    }
    if (user.disabled_at !== null) {
      return c.json({ error: "User is disabled" }, 403)
    }

    const valid = await verifyPassword(payload.password, user.password_salt, user.password_hash)
    if (!valid) {
      return c.json({ error: "Invalid username or password" }, 401)
    }

    const roles = await getUserRoles(c.env, user.id)
    const summary = await buildUserSummary(c.env, user, roles)

    if (payload.client !== "web") {
      const tokens = await issueNativeDeviceTokens(c.env, user.id, {
        deviceId: payload.deviceId,
        deviceName: payload.deviceName ?? (payload.client === "mobile" ? "Mobile App" : "Desktop App"),
        platform: payload.platform ?? payload.client
      })
      return c.json({ user: summary, tokens })
    }

    const token = await createSession(c.env, user.id, {
      userAgent: c.req.header("User-Agent") ?? null,
      ipAddress: c.req.header("CF-Connecting-IP") ?? null
    })

    c.header("Set-Cookie", sessionCookie(token, c.req.url))
    return c.json({ user: summary })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

authRoutes.post("/api/auth/token/refresh", async (c) => {
  try {
    const payload = await parseJson(c, refreshTokenSchema)
    const rotated = await rotateNativeRefreshToken(c.env, payload.refreshToken)
    if (!rotated) {
      return c.json({ error: "Invalid or expired refresh token" }, 401)
    }
    return c.json(rotated)
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

authRoutes.post("/api/auth/oauth/exchange", async (c) => {
  try {
    const payload = await parseJson(c, oauthExchangeSchema)
    const verified = await verifySignedPayload<OAuthExchangePayload>(payload.code, getSigningSecret(c.env))
    if (!verified || verified.typ !== "oauth_exchange" || !verified.userId) {
      return c.json({ error: "Invalid or expired OAuth exchange code" }, 400)
    }

    const user = await getUserById(c.env, verified.userId)
    if (!user || user.disabled_at !== null) {
      return c.json({ error: "User is unavailable" }, 403)
    }

    const roles = await getUserRoles(c.env, user.id)
    const summary = await buildUserSummary(c.env, user, roles)
    const tokens = await issueNativeDeviceTokens(c.env, user.id, {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName ?? (verified.client === "mobile" ? "Mobile App" : "Desktop App"),
      platform: payload.platform ?? verified.client
    })
    return c.json({ user: summary, tokens })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

authRoutes.post("/api/auth/logout", async (c) => {
  const auth = c.get("auth")
  if (auth?.sessionKind === "device") {
    await c.env.DB.prepare("UPDATE device_session SET revoked_at = ? WHERE id = ? AND user_id = ?")
      .bind(now(), auth.sessionId, auth.user.id)
      .run()
    return c.json({ success: true })
  }

  const cookies = parseCookies(c.req.header("Cookie") ?? null)
  const token = cookies.get(SESSION_COOKIE_NAME)
  if (token) {
    await deleteSession(c.env, token)
  }
  c.header("Set-Cookie", expiredCookie(SESSION_COOKIE_NAME, cookieSecure(c)))
  return c.json({ success: true })
})

authRoutes.get("/api/auth/devices", async (c) => {
  const auth = requireAuth(c)
  const timestamp = now()

  const [webRows, deviceRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, user_id, token_hash, user_agent, ip_address, expires_at, created_at
       FROM session
       WHERE user_id = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
      .bind(auth.user.id, timestamp)
      .all<WebSessionRow>(),
    c.env.DB.prepare(
      `SELECT *
       FROM device_session
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC
       LIMIT 50`
    )
      .bind(auth.user.id, timestamp)
      .all<DeviceSessionRow>()
  ])

  const devices: DeviceSessionSummary[] = [
    ...deviceRows.results.map((row) => ({
      id: row.id,
      kind: "device" as const,
      deviceId: row.device_id,
      deviceName: row.device_name,
      platform: row.platform,
      ipAddress: null,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      isCurrent: auth.sessionKind === "device" && auth.sessionId === row.id
    })),
    ...webRows.results.map((row) => {
      const parsed = summarizeUserAgent(row.user_agent)
      return {
        id: row.id,
        kind: "web" as const,
        deviceId: null,
        deviceName: parsed.deviceName,
        platform: parsed.platform,
        ipAddress: row.ip_address,
        lastSeenAt: row.created_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        isCurrent: auth.sessionKind === "web" && auth.sessionId === row.id
      }
    })
  ].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || b.lastSeenAt - a.lastSeenAt)

  return c.json({ devices })
})

authRoutes.delete("/api/auth/devices/:id", async (c) => {
  const auth = requireAuth(c)
  const id = c.req.param("id")

  const [webRes, devRes] = await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM session WHERE id = ? AND user_id = ?").bind(id, auth.user.id),
    c.env.DB.prepare("UPDATE device_session SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL").bind(
      now(),
      id,
      auth.user.id
    )
  ])

  if ((webRes?.meta.changes ?? 0) === 0 && (devRes?.meta.changes ?? 0) === 0) {
    return c.json({ error: "Device session not found" }, 404)
  }

  return c.json({ success: true })
})

authRoutes.get("/api/auth/github/start", async (c) => {
  const config = await getSiteConfig(c.env, true)
  const clientId = config.github.clientId
  if (!config.github.enabled || !clientId || !config.github.clientSecret) {
    throw new HTTPException(500, { message: "GitHub OAuth is not configured" })
  }

  const rawClient = c.req.query("client")
  const client: ClientType = rawClient === "desktop" || rawClient === "mobile" ? rawClient : "web"
  const appUrl = getAppUrl(c)
  const state = await signPayload<OAuthStatePayload>(
    {
      intent: "login",
      client,
      nonce: randomToken(16),
      exp: now() + 10 * 60 * 1000
    },
    getSigningSecret(c.env)
  )

  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", `${appUrl}/api/auth/github/callback`)
  url.searchParams.set("scope", "read:user user:email")
  url.searchParams.set("state", state)

  c.header("Set-Cookie", oauthStateCookie(state, c.req.url))
  return c.redirect(url.toString())
})

authRoutes.get("/api/auth/github/bind/start", async (c) => {
  const auth = requireAuth(c)
  const config = await getSiteConfig(c.env, true)
  const clientId = config.github.clientId
  if (!config.github.enabled || !clientId || !config.github.clientSecret) {
    throw new HTTPException(500, { message: "GitHub OAuth is not configured" })
  }

  const appUrl = getAppUrl(c)
  const state = await signPayload<OAuthStatePayload>(
    {
      intent: "bind",
      client: "web",
      userId: auth.user.id,
      nonce: randomToken(16),
      exp: now() + 10 * 60 * 1000
    },
    getSigningSecret(c.env)
  )

  const url = new URL("https://github.com/login/oauth/authorize")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", `${appUrl}/api/auth/github/callback`)
  url.searchParams.set("scope", "read:user user:email")
  url.searchParams.set("state", state)

  c.header("Set-Cookie", oauthStateCookie(state, c.req.url))
  return c.redirect(url.toString())
})

authRoutes.get("/api/auth/github/callback", async (c) => {
  const config = await getSiteConfig(c.env, true)
  const clientId = config.github.clientId
  const clientSecret = config.github.clientSecret
  if (!config.github.enabled || !clientId || !clientSecret) {
    throw new HTTPException(500, { message: "GitHub OAuth is not configured" })
  }

  const code = c.req.query("code")
  const state = c.req.query("state")
  const cookies = parseCookies(c.req.header("Cookie") ?? null)
  if (!code || !state || cookies.get(OAUTH_STATE_COOKIE_NAME) !== state) {
    throw new HTTPException(400, { message: "Invalid GitHub OAuth state" })
  }

  const statePayload = await verifySignedPayload<OAuthStatePayload>(state, getSigningSecret(c.env))
  if (!statePayload) {
    throw new HTTPException(400, { message: "Expired or invalid OAuth state" })
  }

  const appUrl = getAppUrl(c)
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "notepad"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${appUrl}/api/auth/github/callback`
    })
  })
  const tokenPayload = (await tokenResponse.json()) as unknown
  const accessToken =
    isRecord(tokenPayload) && typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : null
  if (!accessToken) {
    throw new HTTPException(400, { message: "GitHub token exchange failed" })
  }

  const githubUserResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "notepad"
    }
  })
  const githubUser = (await githubUserResponse.json()) as unknown
  if (!isRecord(githubUser) || typeof githubUser.id !== "number" || typeof githubUser.login !== "string") {
    throw new HTTPException(400, { message: "GitHub user lookup failed" })
  }

  let email = typeof githubUser.email === "string" ? githubUser.email : null
  if (!email) {
    const emailResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "notepad"
      }
    })
    const emails = (await emailResponse.json()) as unknown
    if (Array.isArray(emails)) {
      const primary = emails.find(
        (item) => isRecord(item) && item.primary === true && item.verified === true && typeof item.email === "string"
      )
      email = isRecord(primary) && typeof primary.email === "string" ? primary.email : null
    }
  }

  const providerUserId = githubUser.id.toString()
  const providerLogin = githubUser.login
  const avatarUrl = typeof githubUser.avatar_url === "string" ? githubUser.avatar_url : null
  const displayName = typeof githubUser.name === "string" && githubUser.name.trim() ? githubUser.name.trim() : null

  c.header("Set-Cookie", expiredCookie(OAUTH_STATE_COOKIE_NAME, cookieSecure(c)))

  if (statePayload.intent === "bind") {
    const auth = c.get("auth")
    if (!auth || !statePayload.userId || auth.user.id !== statePayload.userId) {
      return c.redirect(`${appUrl}/profile?bind=unauthorized`)
    }

    const existingBinding = await c.env.DB.prepare(
      "SELECT user_id FROM account WHERE provider = 'github' AND provider_user_id = ?"
    )
      .bind(providerUserId)
      .first<{ user_id: string }>()

    if (existingBinding && existingBinding.user_id !== auth.user.id) {
      return c.redirect(`${appUrl}/profile?bind=conflict`)
    }

    const ownBinding = await c.env.DB.prepare(
      "SELECT id FROM account WHERE user_id = ? AND provider = 'github'"
    )
      .bind(auth.user.id)
      .first<{ id: string }>()

    if (ownBinding) {
      await c.env.DB.prepare(
        `UPDATE account
         SET provider_user_id = ?, provider_login = ?, provider_email = ?
         WHERE id = ?`
      )
        .bind(providerUserId, providerLogin, email, ownBinding.id)
        .run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO account (id, user_id, provider, provider_user_id, provider_login, provider_email, created_at)
         VALUES (?, ?, 'github', ?, ?, ?, ?)`
      )
        .bind(crypto.randomUUID(), auth.user.id, providerUserId, providerLogin, email, now())
        .run()
    }

    await c.env.DB.prepare(
      `UPDATE user
       SET avatar_url = COALESCE(avatar_url, ?), updated_at = ?
       WHERE id = ?`
    )
      .bind(avatarUrl, now(), auth.user.id)
      .run()

    return c.redirect(`${appUrl}/profile?bind=success`)
  }

  const account = await c.env.DB.prepare(
    "SELECT user_id FROM account WHERE provider = 'github' AND provider_user_id = ?"
  )
    .bind(providerUserId)
    .first<{ user_id: string }>()

  let user: UserRow | null = account ? await getUserById(c.env, account.user_id) : null
  let assignedRole = ROLES.PENDING as string

  if (user && user.disabled_at !== null) {
    throw new HTTPException(403, { message: "User is disabled" })
  }

  if (!user) {
    const emailTaken = email
      ? await c.env.DB.prepare("SELECT 1 FROM user WHERE email = ?").bind(email).first()
      : null

    const created = await createUserWithAtomicBootstrap(c.env, {
      username: await uniqueGithubUsername(c.env, providerLogin),
      email: emailTaken ? null : email,
      name: displayName ?? providerLogin,
      avatarUrl,
      passwordHash: null,
      passwordSalt: null
    })
    user = created.user
    assignedRole = created.assignedRole

    await c.env.DB.prepare(
      `INSERT INTO account (id, user_id, provider, provider_user_id, provider_login, provider_email, created_at)
       VALUES (?, ?, 'github', ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), user.id, providerUserId, providerLogin, email, now())
      .run()
  } else {
    const roles = await getUserRoles(c.env, user.id)
    assignedRole = roles[0] ?? ROLES.PENDING
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE account
         SET provider_login = ?, provider_email = ?
         WHERE provider = 'github' AND provider_user_id = ?`
      ).bind(providerLogin, email, providerUserId),
      c.env.DB.prepare(
        `UPDATE user
         SET name = COALESCE(name, ?), avatar_url = COALESCE(?, avatar_url), updated_at = ?
         WHERE id = ?`
      ).bind(displayName, avatarUrl, now(), user.id)
    ])
  }

  // Native clients (Electron Desktop / Capacitor Mobile) exchange a short-lived signed code over deep link
  if (statePayload.client === "desktop" || statePayload.client === "mobile") {
    const exchangeCode = await signPayload<OAuthExchangePayload>(
      {
        typ: "oauth_exchange",
        userId: user.id,
        client: statePayload.client,
        nonce: randomToken(16),
        exp: now() + 2 * 60 * 1000
      },
      getSigningSecret(c.env)
    )
    return c.redirect(`notepad://auth/callback?code=${encodeURIComponent(exchangeCode)}`)
  }

  const token = await createSession(c.env, user.id, {
    userAgent: c.req.header("User-Agent") ?? null,
    ipAddress: c.req.header("CF-Connecting-IP") ?? null
  })
  c.header("Set-Cookie", sessionCookie(token, c.req.url), { append: true })

  return c.redirect(assignedRole === ROLES.PENDING ? `${appUrl}/pending` : `${appUrl}/notes`)
})

authRoutes.delete("/api/auth/github/bind", async (c) => {
  const auth = requireAuth(c)
  if (!auth.user.hasPassword) {
    return c.json({ error: "Set a login password before unlinking GitHub" }, 400)
  }

  await c.env.DB.prepare("DELETE FROM account WHERE user_id = ? AND provider = 'github'")
    .bind(auth.user.id)
    .run()

  return c.json({ success: true })
})

authRoutes.post("/api/auth/password/set", async (c) => {
  const auth = requireAuth(c)
  if (auth.user.hasPassword) {
    return c.json({ error: "Password is already set; use password change instead" }, 409)
  }

  try {
    const payload = await parseJson(c, setPasswordSchema)
    const nextUsername = payload.username ?? auth.rawUser.username

    if (payload.username && payload.username !== auth.rawUser.username) {
      const existing = await c.env.DB.prepare("SELECT id FROM user WHERE username = ? AND id != ?")
        .bind(payload.username, auth.user.id)
        .first()
      if (existing) {
        return c.json({ error: "Username already exists" }, 409)
      }
    }

    const password = await hashPassword(payload.password)
    await c.env.DB.prepare(
      `UPDATE user
       SET username = ?, password_hash = ?, password_salt = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(nextUsername, password.hash, password.salt, now(), auth.user.id)
      .run()

    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})

authRoutes.post("/api/auth/password/change", async (c) => {
  const auth = requireAuth(c)
  if (!auth.rawUser.password_hash || !auth.rawUser.password_salt) {
    return c.json({ error: "No password configured yet" }, 400)
  }

  try {
    const payload = await parseJson(c, changePasswordSchema)
    const valid = await verifyPassword(
      payload.currentPassword,
      auth.rawUser.password_salt,
      auth.rawUser.password_hash
    )
    if (!valid) {
      return c.json({ error: "Current password is incorrect" }, 401)
    }

    const password = await hashPassword(payload.newPassword)
    const timestamp = now()

    const statements = [
      c.env.DB.prepare(
        "UPDATE user SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?"
      ).bind(password.hash, password.salt, timestamp, auth.user.id)
    ]

    if (auth.sessionKind === "web") {
      statements.push(
        c.env.DB.prepare("DELETE FROM session WHERE user_id = ? AND id != ?").bind(
          auth.user.id,
          auth.sessionId
        ),
        c.env.DB.prepare("UPDATE device_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(
          timestamp,
          auth.user.id
        )
      )
    } else {
      statements.push(
        c.env.DB.prepare("DELETE FROM session WHERE user_id = ?").bind(auth.user.id),
        c.env.DB.prepare(
          "UPDATE device_session SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL"
        ).bind(timestamp, auth.user.id, auth.sessionId)
      )
    }

    await c.env.DB.batch(statements)
    return c.json({ success: true })
  } catch (error) {
    return zodErrorResponse(c, error)
  }
})
