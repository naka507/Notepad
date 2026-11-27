# Notepad

Cloudflare Free Tier personal memo, small file vault, custom categories, and timed anonymous sharing tool.

Architecture specification: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Apps & Packages

- `apps/web`: Vue 3 + Vite + Pinia + Element Plus frontend (Cloudflare Pages + Pages Function Service Binding)
- `apps/api`: Cloudflare Workers API (Hono + Zod + D1 + R2 + KV)
- `apps/cleanup`: Hourly Cloudflare Cron Worker for expired sessions, unfinished multipart uploads, R2 deletions, and trash
- `packages/core`: Shared RBAC roles, quotas, Zod schemas, cursor utilities, and API types
- `assets/icon.png` & `assets/icon.svg`: 1024×1024 master application icon (reusable for Web/PWA, Tauri desktop `tauri icon`, and Capacitor mobile `@capacitor/assets`)

## Local Development

```sh
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

- Web UI: `http://localhost:5173`
- API Worker: `http://localhost:8787`
- First registered or GitHub-signed-in user automatically becomes `admin`.
- All subsequent users default to `pending` (no permissions until authorized by admin).

## Live Deployment

- Production Web: `https://note.qqx.qzz.io`
- Pages Fallback URL: `https://notepad-6c8.pages.dev`
- API Health: `https://note.qqx.qzz.io/api/health`
- GitHub OAuth Callback: `https://note.qqx.qzz.io/api/auth/github/callback`

## Cloudflare Free Tier Deployment

```sh
npm run cf:d1:create
npm run cf:r2:create
npm run cf:kv:create
```

Update `database_id`, KV `id`, and `APP_URL` in `apps/api/wrangler.toml` and `apps/cleanup/wrangler.toml`, then run:

```sh
npm run typecheck
npm run build
npm run validate:deploy-config
npm run db:migrate:remote
npm run deploy:workers
npm run deploy:web
```
