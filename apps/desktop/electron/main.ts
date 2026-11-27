import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray
} from "electron"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let pendingOAuthCode: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function getAuthFilePath(): string {
  return path.join(app.getPath("userData"), "auth.enc")
}

function getCacheFilePath(): string {
  return path.join(app.getPath("userData"), "sync-cache.json")
}

function resolveAppIconPath(): string {
  const candidates = [
    path.resolve(__dirname, "../dist/favicon.ico"),
    path.resolve(__dirname, "../dist/icon-192.png"),
    path.resolve(__dirname, "../../../assets/icon.png"),
    path.resolve(__dirname, "../../web/public/icon-192.png")
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
}

function atomicWrite(targetPath: string, data: Buffer | string) {
  const dir = path.dirname(targetPath)
  mkdirSync(dir, { recursive: true })
  const tmpPath = `${targetPath}.${Date.now()}.tmp`
  writeFileSync(tmpPath, data)
  renameSync(tmpPath, targetPath)
}

function handleProtocolUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "notepad:") return
    const code = parsed.searchParams.get("code")
    if (!code) return
    if (mainWindow && !mainWindow.isDestroyed()) {
      showAndFocusWindow()
      mainWindow.webContents.send("desktop:oauth-callback", code)
    } else {
      pendingOAuthCode = code
    }
  } catch {
    // ignore malformed deep links
  }
}

function showAndFocusWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function registerProtocolClient() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("notepad", process.execPath, [path.resolve(process.argv[1]!)])
  } else {
    app.setAsDefaultProtocolClient("notepad")
  }
}

function createTray() {
  const iconPath = resolveAppIconPath()
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip("Notepad")

  const menu = Menu.buildFromTemplate([
    {
      label: "打开 Notepad",
      click: () => showAndFocusWindow()
    },
    {
      label: "快捷新建笔记",
      accelerator: "CommandOrControl+Shift+N",
      click: () => {
        showAndFocusWindow()
        mainWindow?.webContents.send("desktop:quick-action", "new-note")
      }
    },
    {
      label: "立即同步",
      click: () => {
        mainWindow?.webContents.send("desktop:quick-action", "sync")
      }
    },
    { type: "separator" },
    {
      label: "退出 Notepad",
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.on("click", () => {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      showAndFocusWindow()
    }
  })
}

function createWindow() {
  const iconPath = resolveAppIconPath()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    backgroundColor: "#09090b",
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show()
    if (pendingOAuthCode) {
      mainWindow?.webContents.send("desktop:oauth-callback", pendingOAuthCode)
      pendingOAuthCode = null
    }
  })

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("desktop:maximized-changed", true)
  })
  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("desktop:maximized-changed", false)
  })

  mainWindow.on("close", (event) => {
    if (!isQuitting && tray) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url)
    }
    return { action: "deny" }
  })

  const devUrl = process.env.NOTEPAD_DEV_SERVER_URL
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.resolve(__dirname, "../dist/index.html"))
  }
}

function registerIpc() {
  ipcMain.handle("desktop:info", () => ({
    platform: process.platform,
    hostname: os.hostname(),
    version: app.getVersion()
  }))

  ipcMain.handle("desktop:window-minimize", () => {
    mainWindow?.minimize()
  })

  ipcMain.handle("desktop:window-toggle-maximize", () => {
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }
    mainWindow.maximize()
    return true
  })

  ipcMain.handle("desktop:window-close", () => {
    mainWindow?.close()
  })

  ipcMain.handle("desktop:window-is-maximized", () => {
    return mainWindow?.isMaximized() ?? false
  })

  ipcMain.handle("desktop:open-external", async (_event, url: string) => {
    if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle("desktop:auth-load", () => {
    const file = getAuthFilePath()
    if (!existsSync(file)) return null
    try {
      const raw = readFileSync(file)
      const jsonText = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString("utf8")
      return JSON.parse(jsonText)
    } catch {
      return null
    }
  })

  ipcMain.handle("desktop:auth-save", (_event, state: unknown) => {
    const jsonText = JSON.stringify(state)
    const encoded = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(jsonText)
      : Buffer.from(jsonText, "utf8")
    atomicWrite(getAuthFilePath(), encoded)
    return true
  })

  ipcMain.handle("desktop:auth-clear", () => {
    const file = getAuthFilePath()
    if (existsSync(file)) unlinkSync(file)
    return true
  })

  ipcMain.handle("desktop:cache-load", () => {
    const file = getCacheFilePath()
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, "utf8"))
    } catch {
      return null
    }
  })

  ipcMain.handle("desktop:cache-save", (_event, payload: unknown) => {
    atomicWrite(getCacheFilePath(), JSON.stringify(payload))
    return true
  })

  ipcMain.handle("desktop:cache-clear", () => {
    const file = getCacheFilePath()
    if (existsSync(file)) unlinkSync(file)
    return true
  })
}

app.on("second-instance", (_event, argv) => {
  showAndFocusWindow()
  const deepLink = argv.find((arg) => arg.startsWith("notepad://"))
  if (deepLink) handleProtocolUrl(deepLink)
})

app.on("open-url", (event, url) => {
  event.preventDefault()
  handleProtocolUrl(url)
})

app.on("before-quit", () => {
  isQuitting = true
})

app.on("will-quit", () => {
  globalShortcut.unregisterAll()
})

app.whenReady().then(() => {
  registerProtocolClient()
  registerIpc()
  createWindow()
  createTray()

  globalShortcut.register("CommandOrControl+Shift+N", () => {
    showAndFocusWindow()
    mainWindow?.webContents.send("desktop:quick-action", "new-note")
  })

  const initialDeepLink = process.argv.find((arg) => arg.startsWith("notepad://"))
  if (initialDeepLink) handleProtocolUrl(initialDeepLink)

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      showAndFocusWindow()
    }
  })
})
