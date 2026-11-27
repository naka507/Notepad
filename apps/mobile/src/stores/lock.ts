import { defineStore } from "pinia"
import { ref } from "vue"
import {
  isBiometricHardwareAvailable,
  promptNativeBiometric,
  storageGet,
  storageRemove,
  storageSet
} from "@/native/bridge"

export type LockScope = "off" | "totp" | "app"

interface PersistedLockConfig {
  scope: LockScope
  pinHash: string | null
  biometricEnabled: boolean
}

const LOCK_STORAGE_KEY = "notepad_mobile_lock_v1"

async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`notepad-mobile-lock:${pin}`)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export const useLockStore = defineStore("lock", () => {
  const scope = ref<LockScope>("off")
  const pinHash = ref<string | null>(null)
  const biometricEnabled = ref(false)
  const biometricAvailable = ref(false)
  const unlocked = ref(true)
  const initialized = ref(false)

  async function init() {
    if (initialized.value) return
    biometricAvailable.value = await isBiometricHardwareAvailable()
    try {
      const raw = await storageGet(LOCK_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedLockConfig>
        scope.value = parsed.scope ?? "off"
        pinHash.value = parsed.pinHash ?? null
        biometricEnabled.value = Boolean(parsed.biometricEnabled)
        if (scope.value !== "off" && pinHash.value) {
          unlocked.value = false
        }
      }
    } catch {
      // ignore corrupted config
    } finally {
      initialized.value = true
    }
  }

  async function persist() {
    const payload: PersistedLockConfig = {
      scope: scope.value,
      pinHash: pinHash.value,
      biometricEnabled: biometricEnabled.value
    }
    await storageSet(LOCK_STORAGE_KEY, JSON.stringify(payload))
  }

  async function enableLock(newScope: Exclude<LockScope, "off">, pin: string, useBiometric: boolean) {
    pinHash.value = await hashPin(pin)
    scope.value = newScope
    biometricEnabled.value = useBiometric && biometricAvailable.value
    unlocked.value = true
    await persist()
  }

  async function updateScope(nextScope: LockScope) {
    if (nextScope === "off") {
      await disableLock()
      return
    }
    scope.value = nextScope
    await persist()
  }

  async function disableLock() {
    scope.value = "off"
    pinHash.value = null
    biometricEnabled.value = false
    unlocked.value = true
    await storageRemove(LOCK_STORAGE_KEY)
  }

  function lockNow() {
    if (scope.value !== "off" && pinHash.value) {
      unlocked.value = false
    }
  }

  async function verifyPin(pin: string): Promise<boolean> {
    if (!pinHash.value) {
      unlocked.value = true
      return true
    }
    const candidate = await hashPin(pin)
    if (candidate === pinHash.value) {
      unlocked.value = true
      return true
    }
    return false
  }

  async function tryBiometricUnlock(reason: string): Promise<boolean> {
    if (!biometricEnabled.value) return false
    const ok = await promptNativeBiometric(reason)
    if (ok) unlocked.value = true
    return ok
  }

  function isProtected(target: "app" | "totp"): boolean {
    if (unlocked.value || !pinHash.value) return false
    if (scope.value === "app") return true
    if (scope.value === "totp" && target === "totp") return true
    return false
  }

  return {
    scope,
    pinHash,
    biometricEnabled,
    biometricAvailable,
    unlocked,
    initialized,
    init,
    enableLock,
    updateScope,
    disableLock,
    lockNow,
    verifyPin,
    tryBiometricUnlock,
    isProtected
  }
})
