import { fileURLToPath, URL } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  plugins: [vue()],
  publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/renderer", import.meta.url)),
      "@web": fileURLToPath(new URL("../web/src", import.meta.url)),
      "@notepad/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url))
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
})
