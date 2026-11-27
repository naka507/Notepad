import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const errors = []

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8")
}

function assertNoPlaceholder(relativePath, placeholders) {
  const content = read(relativePath)
  for (const placeholder of placeholders) {
    if (content.includes(placeholder)) {
      errors.push(`${relativePath} still contains ${placeholder}`)
    }
  }
  return content
}

const apiConfig = assertNoPlaceholder("apps/api/wrangler.toml", ["${DATABASE_ID}", "${KV_NAMESPACE_ID}"])
assertNoPlaceholder("apps/cleanup/wrangler.toml", ["${DATABASE_ID}"])

const appUrlMatch = apiConfig.match(/APP_URL\s*=\s*"([^"]+)"/)
const appUrl = appUrlMatch?.[1] ?? ""
if (!appUrl) {
  errors.push("apps/api/wrangler.toml is missing APP_URL")
} else if (appUrl.includes("localhost") || appUrl.includes("127.0.0.1")) {
  errors.push("apps/api/wrangler.toml APP_URL is still local")
} else if (!appUrl.startsWith("https://")) {
  errors.push("apps/api/wrangler.toml APP_URL should use https:// in production")
}

const redirects = read("apps/web/public/_redirects").trim()
if (redirects !== "/* /index.html 200") {
  errors.push("apps/web/public/_redirects must contain the Pages SPA fallback")
}

if (errors.length) {
  console.error("Deployment config is not ready:")
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log("Deployment config looks ready.")
