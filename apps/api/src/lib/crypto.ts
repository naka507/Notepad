const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PBKDF2_ITERATIONS = 100000

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64UrlToBytes(value)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(digest))
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  let diff = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }

  return diff === 0
}

export async function hashPassword(
  password: string,
  salt = randomToken(16)
): Promise<{ salt: string; hash: string }> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: base64UrlToArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS
    },
    key,
    256
  )

  return {
    salt,
    hash: bytesToBase64Url(new Uint8Array(bits))
  }
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt)
  return timingSafeEqualString(hash, expectedHash)
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function signPayload<T extends Record<string, unknown>>(
  payload: T,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)))
  const sig = await hmacSign(secret, body)
  return `${body}.${sig}`
}

export async function verifySignedPayload<T extends Record<string, unknown>>(
  token: string,
  secret: string
): Promise<T | null> {
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null

  const expected = await hmacSign(secret, body)
  if (!timingSafeEqualString(sig, expected)) return null

  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(body))) as T
    if (typeof parsed.exp === "number" && parsed.exp < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

async function deriveAesKey(keyMaterial: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(keyMaterial))
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
}

export async function encryptSecret(
  plaintext: string,
  keyMaterial: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveAesKey(keyMaterial)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext)
  )
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv)
  }
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  keyMaterial: string
): Promise<string> {
  const key = await deriveAesKey(keyMaterial)
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToArrayBuffer(iv) },
    key,
    base64UrlToArrayBuffer(ciphertext)
  )
  return decoder.decode(decrypted)
}
