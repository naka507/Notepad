import { build } from "esbuild"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
mkdirSync(resolve(root, "dist-electron"), { recursive: true })

await Promise.all([
  build({
    entryPoints: [resolve(root, "electron/main.ts")],
    outfile: resolve(root, "dist-electron/main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"]
  }),
  build({
    entryPoints: [resolve(root, "electron/preload.ts")],
    outfile: resolve(root, "dist-electron/preload.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["electron"]
  })
])

console.log("Built Electron main and preload bundles.")
