export interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: "Lax" | "Strict" | "None"
  path?: string
  maxAge?: number
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>()
  if (!header) return cookies

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (!rawName) continue
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")))
  }

  return cookies
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  parts.push(`Path=${options.path ?? "/"}`)
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`)
  if (options.httpOnly ?? true) parts.push("HttpOnly")
  if (options.secure) parts.push("Secure")
  return parts.join("; ")
}

export function expiredCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", {
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    httpOnly: true,
    secure
  })
}
