import { z } from "zod"
import { ROLES } from "./permissions"

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/)

export const passwordSchema = z.string().min(8).max(128)

export const clientTypeSchema = z.enum(["web", "desktop", "mobile"])

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  turnstileToken: z.string().optional(),
  client: clientTypeSchema.optional().default("web"),
  deviceId: z.string().trim().min(4).max(128).optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  platform: z.string().trim().min(1).max(40).optional()
})

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
  client: clientTypeSchema.optional().default("web"),
  deviceId: z.string().trim().min(4).max(128).optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  platform: z.string().trim().min(1).max(40).optional()
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(16).max(512)
})

export const oauthExchangeSchema = z.object({
  code: z.string().min(16).max(1024),
  deviceId: z.string().trim().min(4).max(128).optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  platform: z.string().trim().min(1).max(40).optional()
})

export const setPasswordSchema = z.object({
  password: passwordSchema,
  username: usernameSchema.optional()
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema
})

export const categoryScopeSchema = z.enum(["note", "document", "sheet", "file", "totp"])

export const createCategorySchema = z.object({
  scope: categoryScopeSchema.optional().default("note"),
  name: z.string().trim().min(1).max(40),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().trim().max(32).nullable().optional(),
  color: z.string().trim().max(16).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional()
})

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  parentId: z.string().uuid().nullable().optional(),
  icon: z.string().trim().max(32).nullable().optional(),
  color: z.string().trim().max(16).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional()
})

export const createNoteSchema = z.object({
  title: z.string().max(200).optional().default(""),
  content: z.string().max(500_000).optional().default(""),
  categoryId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional().default(false)
})

export const updateNoteSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().max(500_000).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  baseVersion: z.number().int().min(1).optional()
})

export const multipartInitSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(160).default("application/octet-stream"),
  size: z.number().int().min(1),
  categoryId: z.string().uuid().nullable().optional()
})

export const multipartCompleteSchema = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1)
      })
    )
    .min(1),
  sha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).nullable().optional()
})

export const updateFileSchema = z.object({
  filename: z.string().trim().min(1).max(255).optional(),
  categoryId: z.string().uuid().nullable().optional()
})

export const createDocumentSchema = z.object({
  docType: z.enum(["doc", "sheet"]),
  title: z.string().max(200).optional().default(""),
  content: z.record(z.unknown()).optional(),
  excerpt: z.string().max(240).optional().default(""),
  categoryId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional().default(false)
})

export const updateDocumentSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.record(z.unknown()).optional(),
  excerpt: z.string().max(240).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  baseVersion: z.number().int().min(1).optional()
})

export const createShareSchema = z.object({
  targetType: z.enum(["note", "file", "document"]),
  targetId: z.string().uuid(),
  ttlSec: z.number().int().min(0).optional(),
  permission: z.enum(["view", "download"]).optional().default("download"),
  accessPassword: z.string().trim().min(4).max(64).optional(),
  maxViews: z.number().int().min(1).max(100000).nullable().optional()
})

export const verifyShareSchema = z.object({
  password: z.string().min(1).max(64)
})

export const updateUserRoleSchema = z.object({
  role: z.enum([ROLES.MEMBER, ROLES.USER, ROLES.PENDING])
})

export const updateUserStatusSchema = z.object({
  disabled: z.boolean()
})

export const updateConfigSchema = z.object({
  adminContact: z.string().trim().max(256),
  turnstile: z.object({
    enabled: z.boolean(),
    siteKey: z.string().trim().max(256),
    secretKey: z.string().trim().max(256).optional()
  }),
  github: z.object({
    enabled: z.boolean(),
    clientId: z.string().trim().max(256),
    clientSecret: z.string().trim().max(256).optional()
  }),
  share: z.object({
    defaultTtlSec: z.number().int().min(60).max(86400 * 30),
    memberAllowedTtlSec: z.array(z.number().int().min(60).max(86400 * 30)).min(1).max(10),
    memberMaxTtlSec: z.number().int().min(60).max(86400 * 30)
  }),
  storageGuardrail: z.object({
    softWarnBytes: z.number().int().min(100 * 1024 * 1024),
    hardLimitBytes: z.number().int().min(100 * 1024 * 1024),
    hardLimitEnabled: z.boolean()
  })
})

export const totpAlgorithmSchema = z.enum(["SHA1", "SHA256", "SHA512"])

export const createTotpSchema = z.object({
  issuer: z.string().trim().max(80).optional().default(""),
  accountName: z.string().trim().min(1).max(120),
  secret: z.string().trim().min(8).max(256),
  algorithm: totpAlgorithmSchema.optional().default("SHA1"),
  digits: z.union([z.literal(6), z.literal(8)]).optional().default(6),
  period: z.number().int().min(10).max(120).optional().default(30),
  categoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional().default(0)
})

export const updateTotpSchema = z.object({
  issuer: z.string().trim().max(80).optional(),
  accountName: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  baseVersion: z.number().int().min(1).optional()
})

export const importTotpUrisSchema = z.object({
  uris: z.array(z.string().trim().min(10).max(2048)).min(1).max(100),
  categoryId: z.string().uuid().nullable().optional()
})

export const syncPushSchema = z.object({
  operations: z
    .array(
      z.object({
        clientOpId: z.string().trim().min(1).max(128),
        entity: z.enum(["category", "note", "totp"]),
        action: z.enum(["upsert", "delete"]),
        id: z.string().uuid(),
        baseVersion: z.number().int().min(0).nullable().optional(),
        payload: z.record(z.unknown()).optional()
      })
    )
    .min(1)
    .max(50)
})
