import { PERMISSIONS, type Permission } from "@notepad/core"
import { createRouter, createWebHistory } from "vue-router"
import { useAuthStore } from "@/stores/auth"
import DocumentsView from "@/views/DocumentsView.vue"
import FilesView from "@/views/FilesView.vue"
import LoginView from "@/views/LoginView.vue"
import NotesView from "@/views/NotesView.vue"
import PendingView from "@/views/PendingView.vue"
import ProfileView from "@/views/ProfileView.vue"
import PublicShareView from "@/views/PublicShareView.vue"
import SharesView from "@/views/SharesView.vue"
import SheetsView from "@/views/SheetsView.vue"
import TotpView from "@/views/TotpView.vue"
import UsersView from "@/views/UsersView.vue"

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/notes" },
    { path: "/workspace", redirect: "/notes" },
    { path: "/categories", redirect: "/notes" },
    { path: "/login", component: LoginView, meta: { publicOnly: true } },
    { path: "/s/:code", component: PublicShareView, meta: { anonymous: true } },
    { path: "/pending", component: PendingView },
    { path: "/notes", component: NotesView, meta: { permission: PERMISSIONS.NOTE_MANAGE } },
    { path: "/docs", component: DocumentsView, meta: { permission: PERMISSIONS.NOTE_MANAGE } },
    { path: "/sheets", component: SheetsView, meta: { permission: PERMISSIONS.NOTE_MANAGE } },
    { path: "/files", component: FilesView, meta: { permission: PERMISSIONS.FILE_MANAGE } },
    { path: "/totp", component: TotpView, meta: { permission: PERMISSIONS.TOTP_MANAGE } },
    { path: "/shares", component: SharesView, meta: { permission: PERMISSIONS.SHARE_MANAGE } },
    { path: "/users", component: UsersView, meta: { permission: PERMISSIONS.USER_MANAGE } },
    { path: "/profile", component: ProfileView }
  ]
})

router.beforeEach(async (to) => {
  if (to.meta.anonymous) {
    return true
  }

  const auth = useAuthStore()
  if (!auth.loaded) {
    try {
      await auth.loadSession()
    } catch {
      auth.user = null
      auth.loaded = true
    }
  }

  if (to.path !== "/login" && !auth.user) {
    return "/login"
  }

  if (to.path === "/login" && auth.user) {
    return auth.hasWorkspaceAccess ? "/notes" : "/pending"
  }

  if (to.path === "/pending" && auth.hasWorkspaceAccess) {
    return "/notes"
  }

  const permission = to.meta.permission as Permission | undefined
  if (permission && !auth.hasPermission(permission)) {
    return auth.hasWorkspaceAccess ? "/notes" : "/pending"
  }

  return true
})
