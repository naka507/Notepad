export interface CloudflareBindings {
  DB: D1Database
  FILES_BUCKET: R2Bucket
  SITE_CONFIG: KVNamespace
  APP_URL?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
  TOKEN_SIGNING_SECRET?: string
}
