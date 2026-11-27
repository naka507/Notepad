import {
  DEFAULT_MEMBER_ALLOWED_SHARE_TTL_SEC,
  DEFAULT_MEMBER_MAX_SHARE_TTL_SEC,
  DEFAULT_R2_HARD_LIMIT_BYTES,
  DEFAULT_R2_SOFT_WARN_BYTES,
  DEFAULT_SHARE_TTL_SEC,
  SITE_CONFIG_KV_KEY,
  type SiteConfig
} from "@notepad/core"
import type { CloudflareBindings } from "../env"

interface StoredSiteConfig {
  adminContact?: string
  turnstile?: {
    enabled?: boolean
    siteKey?: string
    secretKey?: string
  }
  github?: {
    enabled?: boolean
    clientId?: string
    clientSecret?: string
  }
  share?: {
    defaultTtlSec?: number
    memberAllowedTtlSec?: number[]
    memberMaxTtlSec?: number
  }
  storageGuardrail?: {
    softWarnBytes?: number
    hardLimitBytes?: number
    hardLimitEnabled?: boolean
  }
}

const CACHE_TTL_MS = 30_000
let cachedStored: { value: StoredSiteConfig; expiresAt: number } | null = null

export function invalidateSiteConfigCache(): void {
  cachedStored = null
}

async function readStoredConfig(env: CloudflareBindings): Promise<StoredSiteConfig> {
  const now = Date.now()
  if (cachedStored && cachedStored.expiresAt > now) {
    return cachedStored.value
  }

  let parsed: StoredSiteConfig = {}
  try {
    const raw = await env.SITE_CONFIG.get(SITE_CONFIG_KV_KEY)
    if (raw) {
      parsed = JSON.parse(raw) as StoredSiteConfig
    }
  } catch {
    parsed = {}
  }

  cachedStored = { value: parsed, expiresAt: now + CACHE_TTL_MS }
  return parsed
}

export async function getSiteConfig(env: CloudflareBindings, includeSecret: boolean): Promise<SiteConfig> {
  const stored = await readStoredConfig(env)

  const resolvedGithubClientId = stored.github?.clientId || env.GITHUB_CLIENT_ID || ""
  const resolvedGithubClientSecret = stored.github?.clientSecret || env.GITHUB_CLIENT_SECRET || ""
  const githubEnabled =
    stored.github?.enabled === undefined
      ? Boolean(resolvedGithubClientId && resolvedGithubClientSecret)
      : stored.github.enabled

  const allowedTtl =
    Array.isArray(stored.share?.memberAllowedTtlSec) && stored.share.memberAllowedTtlSec.length > 0
      ? [...new Set(stored.share.memberAllowedTtlSec)].sort((a, b) => a - b)
      : [...DEFAULT_MEMBER_ALLOWED_SHARE_TTL_SEC]

  const memberMaxTtlSec = stored.share?.memberMaxTtlSec ?? DEFAULT_MEMBER_MAX_SHARE_TTL_SEC
  const defaultTtlSec = stored.share?.defaultTtlSec ?? DEFAULT_SHARE_TTL_SEC

  return {
    adminContact: stored.adminContact ?? "",
    turnstile: {
      enabled: Boolean(stored.turnstile?.enabled),
      siteKey: stored.turnstile?.siteKey ?? "",
      ...(includeSecret ? { secretKey: stored.turnstile?.secretKey ?? "" } : {})
    },
    github: {
      enabled: githubEnabled,
      clientId: resolvedGithubClientId,
      clientSecretConfigured: Boolean(resolvedGithubClientSecret),
      ...(includeSecret ? { clientSecret: resolvedGithubClientSecret } : {})
    },
    share: {
      defaultTtlSec,
      memberAllowedTtlSec: allowedTtl,
      memberMaxTtlSec
    },
    storageGuardrail: {
      softWarnBytes: stored.storageGuardrail?.softWarnBytes ?? DEFAULT_R2_SOFT_WARN_BYTES,
      hardLimitBytes: stored.storageGuardrail?.hardLimitBytes ?? DEFAULT_R2_HARD_LIMIT_BYTES,
      hardLimitEnabled: stored.storageGuardrail?.hardLimitEnabled ?? true
    }
  }
}

export async function saveSiteConfig(env: CloudflareBindings, next: SiteConfig): Promise<void> {
  const existing = await readStoredConfig(env)

  const toStore: StoredSiteConfig = {
    adminContact: next.adminContact,
    turnstile: {
      enabled: next.turnstile.enabled,
      siteKey: next.turnstile.siteKey,
      secretKey:
        next.turnstile.secretKey !== undefined && next.turnstile.secretKey !== ""
          ? next.turnstile.secretKey
          : existing.turnstile?.secretKey ?? ""
    },
    github: {
      enabled: next.github.enabled,
      clientId: next.github.clientId,
      clientSecret:
        next.github.clientSecret !== undefined && next.github.clientSecret !== ""
          ? next.github.clientSecret
          : existing.github?.clientSecret ?? ""
    },
    share: {
      defaultTtlSec: next.share.defaultTtlSec,
      memberAllowedTtlSec: [...new Set(next.share.memberAllowedTtlSec)].sort((a, b) => a - b),
      memberMaxTtlSec: next.share.memberMaxTtlSec
    },
    storageGuardrail: {
      softWarnBytes: next.storageGuardrail.softWarnBytes,
      hardLimitBytes: next.storageGuardrail.hardLimitBytes,
      hardLimitEnabled: next.storageGuardrail.hardLimitEnabled
    }
  }

  await env.SITE_CONFIG.put(SITE_CONFIG_KV_KEY, JSON.stringify(toStore))
  invalidateSiteConfigCache()
}
