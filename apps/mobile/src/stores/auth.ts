import { ROLES, type Permission, type SiteConfig, type UserSummary } from "@notepad/core"
import { defineStore } from "pinia"
import { computed, ref } from "vue"
import {
  api,
  clearPersistedMobileTokens,
  DEFAULT_SERVER_URL,
  loadPersistedMobileAuth,
  normalizeServerUrl,
  savePersistedMobileAuth,
  setOnSessionExpired
} from "@/api/client"

export const useAuthStore = defineStore("auth", () => {
  const user = ref<UserSummary | null>(null)
  const siteConfig = ref<SiteConfig | null>(null)
  const serverUrl = ref(DEFAULT_SERVER_URL)
  const initialized = ref(false)
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))
  const isPending = computed(() => user.value?.role === ROLES.PENDING)

  function can(permission: Permission) {
    return Boolean(user.value?.permissions.includes(permission))
  }

  async function init() {
    loading.value = true
    try {
      const persisted = await loadPersistedMobileAuth()
      serverUrl.value = persisted.serverUrl
      setOnSessionExpired(() => {
        user.value = null
      })

      try {
        siteConfig.value = await api.config()
      } catch {
        siteConfig.value = null
      }

      if (persisted.tokens?.accessToken) {
        try {
          const res = await api.session()
          user.value = res.user
        } catch {
          user.value = null
        }
      } else {
        user.value = null
      }
    } finally {
      initialized.value = true
      loading.value = false
    }
  }

  async function setServerUrl(nextUrl: string) {
    const normalized = normalizeServerUrl(nextUrl)
    serverUrl.value = normalized
    await savePersistedMobileAuth({ serverUrl: normalized })
    try {
      siteConfig.value = await api.config()
    } catch {
      siteConfig.value = null
    }
  }

  async function refreshSession() {
    const [sessionRes, configRes] = await Promise.all([
      api.session(),
      api.config().catch(() => siteConfig.value)
    ])
    user.value = sessionRes.user
    siteConfig.value = configRes
  }

  async function login(payload: { username: string; password: string; turnstileToken?: string }) {
    const res = await api.login(payload)
    user.value = res.user
    return res.user
  }

  async function register(payload: { username: string; password: string; turnstileToken?: string }) {
    const res = await api.register(payload)
    user.value = res.user
    return res.user
  }

  async function exchangeOAuthCode(code: string) {
    const res = await api.exchangeOAuthCode(code)
    user.value = res.user
    return res.user
  }

  async function logout() {
    await api.logout()
    user.value = null
  }

  async function clearLocalAuth() {
    await clearPersistedMobileTokens()
    user.value = null
  }

  return {
    user,
    siteConfig,
    serverUrl,
    initialized,
    loading,
    isAuthenticated,
    isPending,
    can,
    init,
    setServerUrl,
    refreshSession,
    login,
    register,
    exchangeOAuthCode,
    logout,
    clearLocalAuth
  }
})
