import type { TotpAlgorithm } from "./types"

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function normalizeBase32Secret(raw: string): string {
  const cleaned = raw.trim().replace(/[\s\-]+/g, "").toUpperCase().replace(/=+$/g, "")
  if (!cleaned || !/^[A-Z2-7]+$/.test(cleaned)) {
    throw new Error("Invalid Base32 TOTP secret")
  }
  return cleaned
}

export function base32ToBytes(secret: string): Uint8Array {
  const normalized = normalizeBase32Secret(secret)
  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) throw new Error("Invalid Base32 character")
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}

function webCryptoHashName(algorithm: TotpAlgorithm): "SHA-1" | "SHA-256" | "SHA-512" {
  if (algorithm === "SHA256") return "SHA-256"
  if (algorithm === "SHA512") return "SHA-512"
  return "SHA-1"
}

export async function generateTotpCode(options: {
  secret: string
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
  timestamp?: number
}): Promise<{ code: string; remainingSec: number; period: number }> {
  const algorithm = options.algorithm ?? "SHA1"
  const digits = options.digits === 8 ? 8 : 6
  const period = options.period && options.period > 0 ? options.period : 30
  const nowSec = Math.floor((options.timestamp ?? Date.now()) / 1000)
  const counter = Math.floor(nowSec / period)
  const remainingSec = period - (nowSec % period)

  const keyBytes = base32ToBytes(options.secret)
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength)
  new Uint8Array(keyBuffer).set(keyBytes)

  const counterBuffer = new ArrayBuffer(8)
  const view = new DataView(counterBuffer)
  const high = Math.floor(counter / 0x100000000)
  const low = counter >>> 0
  view.setUint32(0, high, false)
  view.setUint32(4, low, false)

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "HMAC", hash: webCryptoHashName(algorithm) },
    false,
    ["sign"]
  )
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBuffer))
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff)

  const mod = 10 ** digits
  const code = String(binary % mod).padStart(digits, "0")
  return { code, remainingSec, period }
}

export interface ParsedOtpAuth {
  issuer: string
  accountName: string
  secret: string
  algorithm: TotpAlgorithm
  digits: 6 | 8
  period: number
}

export function parseOtpAuthUri(rawUri: string): ParsedOtpAuth | null {
  const trimmed = rawUri.trim()
  if (!trimmed.toLowerCase().startsWith("otpauth://totp/")) return null

  try {
    const url = new URL(trimmed)
    const rawSecret = url.searchParams.get("secret")
    if (!rawSecret) return null
    const secret = normalizeBase32Secret(rawSecret)

    const rawLabel = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    let labelIssuer = ""
    let accountName = rawLabel
    const colonIdx = rawLabel.indexOf(":")
    if (colonIdx !== -1) {
      labelIssuer = rawLabel.slice(0, colonIdx).trim()
      accountName = rawLabel.slice(colonIdx + 1).trim()
    }

    const issuer = (url.searchParams.get("issuer")?.trim() || labelIssuer || accountName || "2FA").slice(0, 80)
    const cleanAccount = (accountName || issuer).slice(0, 120)

    const rawAlg = (url.searchParams.get("algorithm") || "SHA1").toUpperCase().replace("-", "")
    const algorithm: TotpAlgorithm =
      rawAlg === "SHA256" ? "SHA256" : rawAlg === "SHA512" ? "SHA512" : "SHA1"

    const parsedDigits = Number(url.searchParams.get("digits") || "6")
    const digits: 6 | 8 = parsedDigits === 8 ? 8 : 6

    const parsedPeriod = Number(url.searchParams.get("period") || "30")
    const period = Number.isInteger(parsedPeriod) && parsedPeriod >= 10 && parsedPeriod <= 120 ? parsedPeriod : 30

    return {
      issuer,
      accountName: cleanAccount,
      secret,
      algorithm,
      digits,
      period
    }
  } catch {
    return null
  }
}

export function buildOtpAuthUri(entry: {
  issuer: string
  accountName: string
  secret: string
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
}): string {
  const label = entry.issuer
    ? `${encodeURIComponent(entry.issuer)}:${encodeURIComponent(entry.accountName || entry.issuer)}`
    : encodeURIComponent(entry.accountName || "2FA")
  const params = new URLSearchParams({
    secret: normalizeBase32Secret(entry.secret),
    issuer: entry.issuer || entry.accountName || "2FA",
    algorithm: entry.algorithm ?? "SHA1",
    digits: String(entry.digits === 8 ? 8 : 6),
    period: String(entry.period ?? 30)
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
