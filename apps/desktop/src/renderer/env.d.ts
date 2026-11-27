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

export interface NotepadDesktopBridge {
  getInfo: () => Promise<{ platform: string; hostname: string; version: string }>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  loadAuthState: () => Promise<DesktopAuthPersisted | null>
  saveAuthState: (state: DesktopAuthPersisted) => Promise<boolean>
  clearAuthState: () => Promise<boolean>
  loadSyncCache: () => Promise<Record<string, unknown> | null>
  saveSyncCache: (payload: Record<string, unknown>) => Promise<boolean>
  clearSyncCache: () => Promise<boolean>
  onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  onOAuthCallback: (cb: (code: string) => void) => () => void
  onQuickAction: (cb: (action: "new-note" | "sync") => void) => () => void
}

declare global {
  interface Window {
    notepadDesktop?: NotepadDesktopBridge
  }
}

export {}
