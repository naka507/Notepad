import { App } from "@capacitor/app"
import { Browser } from "@capacitor/browser"
import { Clipboard } from "@capacitor/clipboard"
import { Capacitor } from "@capacitor/core"
import { Haptics, ImpactStyle } from "@capacitor/haptics"
import { Preferences } from "@capacitor/preferences"
import { StatusBar, Style } from "@capacitor/status-bar"
import type { ThemeMode } from "@/theme"

export function isNativeMobile(): boolean {
  return Capacitor.isNativePlatform()
}

export function getMobilePlatform(): "ios" | "android" | "mobile" {
  const p = Capacitor.getPlatform()
  if (p === "ios") return "ios"
  if (p === "android") return "android"
  return "mobile"
}

export async function storageGet(key: string): Promise<string | null> {
  try {
    if (isNativeMobile()) {
      const { value } = await Preferences.get({ key })
      return value
    }
  } catch {
    // fallback to localStorage
  }
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  try {
    if (isNativeMobile()) {
      await Preferences.set({ key, value })
      return
    }
  } catch {
    // fallback to localStorage
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore quota errors
  }
}

export async function storageRemove(key: string): Promise<void> {
  try {
    if (isNativeMobile()) {
      await Preferences.remove({ key })
      return
    }
  } catch {
    // fallback
  }
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export async function hapticImpact(kind: "light" | "medium" = "light"): Promise<void> {
  try {
    if (isNativeMobile()) {
      await Haptics.impact({
        style: kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light
      })
      return
    }
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "medium" ? 16 : 8)
    }
  } catch {
    // ignore unsupported haptics
  }
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    if (isNativeMobile()) {
      await Clipboard.write({ string: text })
      return
    }
  } catch {
    // fallback to Web Clipboard API
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  textarea.remove()
}

export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (isNativeMobile()) {
      await Browser.open({ url })
      return
    }
  } catch {
    // fallback
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export async function syncStatusBarTheme(mode: ThemeMode): Promise<void> {
  const color = mode === "dark" ? "#09090b" : "#f5f5f5"
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", color)
  if (!isNativeMobile()) return
  try {
    await StatusBar.setStyle({ style: mode === "dark" ? Style.Dark : Style.Light })
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color })
    }
  } catch {
    // ignore if unavailable
  }
}

export interface MobileLifecycleHandlers {
  onOAuthCode: (code: string) => void
  onBackButton: () => boolean
  onBackground?: () => void
  onResume?: () => void
}

export function registerMobileLifecycle(handlers: MobileLifecycleHandlers): () => void {
  if (!isNativeMobile()) return () => {}
  const removers: Array<() => void> = []

  void App.addListener("appUrlOpen", (event) => {
    try {
      const parsed = new URL(event.url)
      if (parsed.protocol === "notepad:" && parsed.hostname === "auth") {
        const code = parsed.searchParams.get("code")
        if (code) {
          void Browser.close().catch(() => {})
          handlers.onOAuthCode(code)
        }
      }
    } catch {
      // ignore malformed URL
    }
  }).then((handle) => removers.push(() => void handle.remove()))

  void App.addListener("backButton", () => {
    const handled = handlers.onBackButton()
    if (!handled) {
      void App.minimizeApp().catch(() => {})
    }
  }).then((handle) => removers.push(() => void handle.remove()))

  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      handlers.onResume?.()
    } else {
      handlers.onBackground?.()
    }
  }).then((handle) => removers.push(() => void handle.remove()))

  return () => {
    for (const remove of removers) remove()
  }
}

interface NativeBiometricPluginLike {
  isAvailable?: () => Promise<{ isAvailable?: boolean }>
  verifyIdentity?: (options: { reason?: string; title?: string }) => Promise<void>
}

function getOptionalBiometricPlugin(): NativeBiometricPluginLike | null {
  const plugins = (Capacitor as unknown as { Plugins?: Record<string, NativeBiometricPluginLike> }).Plugins
  return plugins?.NativeBiometric ?? plugins?.BiometricAuth ?? null
}

export async function isBiometricHardwareAvailable(): Promise<boolean> {
  const nativePlugin = getOptionalBiometricPlugin()
  if (nativePlugin?.isAvailable) {
    try {
      const res = await nativePlugin.isAvailable()
      if (res?.isAvailable) return true
    } catch {
      // continue checking WebAuthn
    }
  }
  try {
    if (
      typeof window !== "undefined" &&
      "PublicKeyCredential" in window &&
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    }
  } catch {
    // ignore
  }
  return false
}

export async function promptNativeBiometric(reason: string): Promise<boolean> {
  const nativePlugin = getOptionalBiometricPlugin()
  if (nativePlugin?.verifyIdentity) {
    try {
      await nativePlugin.verifyIdentity({ reason, title: "Notepad" })
      return true
    } catch {
      return false
    }
  }
  return false
}
