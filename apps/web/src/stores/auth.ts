import { PERMISSIONS, type Permission, type UserSummary } from "@notepad/core"
import { defineStore } from "pinia"
import { api } from "@/api/client"

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: null as UserSummary | null,
    loaded: false
  }),
  getters: {
    hasPermission: (state) => (permission: Permission) =>
      state.user?.permissions.includes(permission) ?? false,
    hasWorkspaceAccess: (state) => state.user?.permissions.includes(PERMISSIONS.NOTE_MANAGE) ?? false
  },
  actions: {
    async loadSession() {
      const response = await api.session()
      this.user = response.user
      this.loaded = true
    },
    async login(username: string, password: string, turnstileToken?: string) {
      const response = await api.login({
        username,
        password,
        ...(turnstileToken ? { turnstileToken } : {})
      })
      this.user = response.user
      this.loaded = true
    },
    async register(username: string, password: string, turnstileToken?: string) {
      const response = await api.register({
        username,
        password,
        ...(turnstileToken ? { turnstileToken } : {})
      })
      this.user = response.user
      this.loaded = true
    },
    async logout() {
      await api.logout()
      this.user = null
      this.loaded = true
    }
  }
})
