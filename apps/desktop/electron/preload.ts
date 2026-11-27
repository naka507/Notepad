import { contextBridge, ipcRenderer } from "electron"

export interface DesktopAuthPersisted {
  serverUrl: string
  deviceId: string
  tokens: {
    accessToken: string
    refreshToken: string
    accessExpiresAt: number
    refreshExpiresAt: number
    deviceSessionId: string
  } | null
}

const bridge = {
  getInfo: () => ipcRenderer.invoke("desktop:info") as Promise<{ platform: string; hostname: string; version: string }>,
  minimize: () => ipcRenderer.invoke("desktop:window-minimize") as Promise<void>,
  toggleMaximize: () => ipcRenderer.invoke("desktop:window-toggle-maximize") as Promise<boolean>,
  close: () => ipcRenderer.invoke("desktop:window-close") as Promise<void>,
  isMaximized: () => ipcRenderer.invoke("desktop:window-is-maximized") as Promise<boolean>,
  openExternal: (url: string) => ipcRenderer.invoke("desktop:open-external", url) as Promise<void>,
  loadAuthState: () => ipcRenderer.invoke("desktop:auth-load") as Promise<DesktopAuthPersisted | null>,
  saveAuthState: (state: DesktopAuthPersisted) => ipcRenderer.invoke("desktop:auth-save", state) as Promise<boolean>,
  clearAuthState: () => ipcRenderer.invoke("desktop:auth-clear") as Promise<boolean>,
  loadSyncCache: () => ipcRenderer.invoke("desktop:cache-load") as Promise<Record<string, unknown> | null>,
  saveSyncCache: (payload: Record<string, unknown>) => ipcRenderer.invoke("desktop:cache-save", payload) as Promise<boolean>,
  clearSyncCache: () => ipcRenderer.invoke("desktop:cache-clear") as Promise<boolean>,
  onMaximizedChange: (cb: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: boolean) => cb(value)
    ipcRenderer.on("desktop:maximized-changed", listener)
    return () => ipcRenderer.removeListener("desktop:maximized-changed", listener)
  },
  onOAuthCallback: (cb: (code: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, code: string) => cb(code)
    ipcRenderer.on("desktop:oauth-callback", listener)
    return () => ipcRenderer.removeListener("desktop:oauth-callback", listener)
  },
  onQuickAction: (cb: (action: "new-note" | "sync") => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: "new-note" | "sync") => cb(action)
    ipcRenderer.on("desktop:quick-action", listener)
    return () => ipcRenderer.removeListener("desktop:quick-action", listener)
  }
}

contextBridge.exposeInMainWorld("notepadDesktop", bridge)
