import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx"

async function runOnce(cmd, args) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" })
    child.on("exit", (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited with ${code}`))))
  })
}

async function waitForUrl(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

await runOnce(npmCmd, ["run", "build:electron"])

const vite = spawn(npmCmd, ["run", "dev:renderer"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32"
})

try {
  await waitForUrl("http://127.0.0.1:5180/")
  const electron = spawn(npxCmd, ["electron", "."], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      NOTEPAD_DEV_SERVER_URL: "http://127.0.0.1:5180/"
    }
  })

  electron.on("exit", () => {
    vite.kill()
    process.exit(0)
  })
} catch (error) {
  vite.kill()
  console.error(error)
  process.exit(1)
}
