import path from "node:path"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  plugins: [vue()],
  publicDir: path.resolve(__dirname, "../web/public"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@web": path.resolve(__dirname, "../web/src"),
      "@notepad/core": path.resolve(__dirname, "../../packages/core/src/index.ts")
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5181,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
})
