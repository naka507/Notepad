# Notepad

Cloudflare Free Tier personal memo, small file vault, custom categories, and timed anonymous sharing tool.

Architecture specification: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Apps & Packages

- `apps/web`: Vue 3 + Vite + Pinia + Element Plus frontend (Cloudflare Pages + Pages Function Service Binding)
- `apps/desktop`: Electron desktop app with rewritten 3-pane layout (frameless titlebar, Activity Rail, `Ctrl+K` Command Palette, system tray, `safeStorage` OS keychain, offline sync cache, `notepad://` OAuth deep link)
- `apps/mobile`: Capacitor mobile app (Android/iOS) with rewritten single-stack + bottom 5-Tab layout, card-style 2FA authenticator, live camera `otpauth://` QR scanner, biometric/PIN lock, and member-consistent mobile settings
- `apps/api`: Cloudflare Workers API (Hono + Zod + D1 + R2 + KV)
- `apps/cleanup`: Hourly Cloudflare Cron Worker for expired sessions, unfinished multipart uploads, R2 deletions, and trash
- `packages/core`: Shared RBAC roles, quotas, Zod schemas, cursor utilities, and API types
- `assets/icon.png` & `assets/icon.svg`: 1024×1024 master application icon (reusable for Web/PWA, Electron `electron-builder`, and Capacitor mobile `@capacitor/assets`)

## Local Development

```sh
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local
npm run dev:api
npm run dev:web
```

### Desktop App (Electron)

```sh
# If npm blocks Electron's postinstall script on first install, download the runtime binary once:
node node_modules/electron/install.js

# Start Vite renderer + Electron window
npm run dev:desktop

# Production build & platform installer packaging (NSIS / DMG / AppImage)
npm run build:desktop
npm run package:desktop
```

### Mobile App (Capacitor Android / iOS)

```sh
# Preview mobile UI in browser (http://127.0.0.1:5181)
npm run dev:mobile

# Build mobile web bundle & sync native Capacitor projects
npm run build:mobile
npm run cap:sync

# Add and open native Android / iOS projects
npm run cap:add:android -w @notepad/mobile
npm run cap:open:android -w @notepad/mobile

# Build signed Android Release APK (configure apps/mobile/android/keystore.properties or ANDROID_KEYSTORE_* env vars)
cd apps/mobile/android && ./gradlew assembleRelease
```

### Automated Releases (GitHub Actions)

- `.github/workflows/ci.yml`: Runs `validate:deploy-config`, `typecheck`, and `build` across all workspaces on every push/PR to `main`.
- `.github/workflows/release.yml`: Triggered by pushing a version tag (e.g. `git tag v1.0.0 && git push --tags`) or manual dispatch. Automatically builds Windows (`.exe`), macOS (`.dmg`), Linux (`.AppImage`), and Android (`.apk`) artifacts and publishes them to GitHub Releases.
  - Optional Android Release signing secrets in GitHub Repo Settings: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

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
