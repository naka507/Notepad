import { PERMISSIONS, type Permission, type UserSummary } from "@notepad/core"
import { defineStore } from "pinia"
import { computed, ref } from "vue"
import {
  DEFAULT_SERVER_URL,
  api,
  clearPersistedDesktopTokens,
  getServerUrl,
  getTokens,
  loadPersistedDesktopAuth,
  savePersistedDesktopAuth,
  setOnSessionExpired
} from "@/api/client"

export const useAuthStore = defineStore("auth", () => {
  const user = ref<UserSummary | null>(null)
  const loaded = ref(false)
  const serverUrl = ref(DEFAULT_SERVER_URL)
  const offline = ref(false)

  const hasWorkspaceAccess = computed(() =>
    Boolean(user.value?.permissions.includes(PERMISSIONS.NOTE_MANAGE))
  )

  function hasPermission(permission: Permission) {
    return Boolean(user.value?.permissions.includes(permission))
  }

  async function init() {
    setOnSessionExpired(() => {
      user.value = null
    })
    const persisted = await loadPersistedDesktopAuth()
    serverUrl.value = persisted.serverUrl
    if (persisted.tokens?.accessToken || persisted.tokens?.refreshToken) {
      await loadSession()
    } else {
      user.value = null
      loaded.value = true
    }
  }

  async function setServerUrl(nextUrl: string) {
    await savePersistedDesktopAuth({ serverUrl: nextUrl })
    serverUrl.value = getServerUrl()
  }

  async function loadSession() {
    try {
      const response = await api.session()
      user.value = response.user
      offline.value = false
    } catch {
      offline.value = Boolean(getTokens()?.refreshToken)
    } finally {
      loaded.value = true
    }
    return user.value
  }

  async function login(payload: { username: string; password: string }) {
    const response = await api.login(payload)
    user.value = response.user
    loaded.value = true
    offline.value = false
    return response.user
  }

  async function register(payload: { username: string; password: string }) {
    const response = await api.register(payload)
    user.value = response.user
    loaded.value = true
    offline.value = false
    return response.user
  }

  async function exchangeOAuthCode(code: string) {
    const response = await api.exchangeOAuthCode(code)
    user.value = response.user
    loaded.value = true
    offline.value = false
    return response.user
  }

  async function logout() {
    await api.logout()
    await clearPersistedDesktopTokens()
    user.value = null
    loaded.value = true
  }

  return {
    user,
    loaded,
    serverUrl,
    offline,
    hasWorkspaceAccess,
    hasPermission,
    init,
    setServerUrl,
    loadSession,
    login,
    register,
    exchangeOAuthCode,
    logout
  }
})
