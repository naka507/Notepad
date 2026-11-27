export const ROLES = {
  ADMIN: "admin",
  MEMBER: "member",
  USER: "user",
  PENDING: "pending"
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]
export type AssignableRole = Exclude<Role, "admin">

export const PERMISSIONS = {
  NOTE_MANAGE: "note:manage",
  FILE_MANAGE: "file:manage",
  SHARE_MANAGE: "share:manage",
  TOTP_MANAGE: "totp:manage",
  USER_MANAGE: "user:manage",
  CONFIG_MANAGE: "config:manage"
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.MEMBER]: [
    PERMISSIONS.NOTE_MANAGE,
    PERMISSIONS.FILE_MANAGE,
    PERMISSIONS.SHARE_MANAGE,
    PERMISSIONS.TOTP_MANAGE
  ],
  [ROLES.USER]: [
    PERMISSIONS.NOTE_MANAGE,
    PERMISSIONS.FILE_MANAGE,
    PERMISSIONS.TOTP_MANAGE
  ],
  [ROLES.PENDING]: []
}

export interface RoleQuota {
  maxFileSize: number | null
  maxFileCount: number | null
  unlimited: boolean
}

export const MB = 1024 * 1024

export const ROLE_QUOTAS: Record<Role, RoleQuota> = {
  [ROLES.ADMIN]: {
    maxFileSize: null,
    maxFileCount: null,
    unlimited: true
  },
  [ROLES.MEMBER]: {
    maxFileSize: 50 * MB,
    maxFileCount: 500,
    unlimited: false
  },
  [ROLES.USER]: {
    maxFileSize: 5 * MB,
    maxFileCount: 100,
    unlimited: false
  },
  [ROLES.PENDING]: {
    maxFileSize: 0,
    maxFileCount: 0,
    unlimited: false
  }
}

export function isRole(value: string): value is Role {
  return value === ROLES.ADMIN || value === ROLES.MEMBER || value === ROLES.USER || value === ROLES.PENDING
}

export function primaryRoleFromRoles(roles: Role[]): Role {
  if (roles.includes(ROLES.ADMIN)) return ROLES.ADMIN
  if (roles.includes(ROLES.MEMBER)) return ROLES.MEMBER
  if (roles.includes(ROLES.USER)) return ROLES.USER
  return ROLES.PENDING
}

export function hasPermission(roles: Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission))
}

export function permissionsForRoles(roles: Role[]): Permission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role] ?? []))]
}

export function quotaForRoles(roles: Role[]): RoleQuota {
  return ROLE_QUOTAS[primaryRoleFromRoles(roles)]
}
