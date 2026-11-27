import DOMPurify from "dompurify"
import { marked } from "marked"
import { t } from "@/i18n"

marked.setOptions({
  gfm: true,
  breaks: true
})

export function renderSafeMarkdown(markdown: string): string {
  const rawHtml = marked.parse(markdown || "", { async: false }) as string
  return DOMPurify.sanitize(rawHtml)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function formatTtlLabel(sec: number): string {
  const key = `share.ttl${sec}`
  const translated = t(key)
  if (translated !== key) return translated
  if (sec === 0) return t("share.permanent")
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

export function formatRemainingTime(expiresAt: number | null): string {
  if (expiresAt === null) return t("share.permanent")
  const diff = expiresAt - Date.now()
  if (diff <= 0) return t("share.expired")
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "< 1m"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export async function sha256Hex(file: File): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null
  try {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest("SHA-256", buffer)
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  } catch {
    return null
  }
}
