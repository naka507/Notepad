<script setup lang="ts">
import { PERMISSIONS } from "@notepad/core"
import {
  FileSpreadsheet,
  FileText,
  HardDrive,
  Link2,
  LogOut,
  Settings,
  StickyNote,
  UserCog
} from "@lucide/vue"
import { computed } from "vue"
import { useRoute, useRouter } from "vue-router"
import LocaleSwitcher from "@/components/LocaleSwitcher.vue"
import ThemeToggle from "@/components/ThemeToggle.vue"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const showTopbar = computed(() => Boolean(auth.user) && !route.meta.anonymous && route.path !== "/login")
const canManageShares = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const canManageUsers = computed(() => auth.hasPermission(PERMISSIONS.USER_MANAGE))

const primaryNav = computed(() => [
  { path: "/notes", label: t("nav.notes"), icon: StickyNote },
  { path: "/docs", label: t("nav.docs"), icon: FileText },
  { path: "/sheets", label: t("nav.sheets"), icon: FileSpreadsheet },
  { path: "/files", label: t("nav.files"), icon: HardDrive }
])

async function goHome() {
  await router.push(auth.hasWorkspaceAccess ? "/notes" : "/pending")
}

async function logout() {
  await auth.logout()
  await router.push("/login")
}
</script>

<template>
  <div class="app-shell">
    <header v-if="showTopbar" class="topbar">
      <button class="brand" type="button" @click="goHome">
        <img src="/favicon.svg" alt="Notepad" class="brand-logo" />
        <span>Notepad</span>
      </button>

      <nav v-if="auth.hasWorkspaceAccess" class="primary-nav" aria-label="Primary">
        <button
          v-for="item in primaryNav"
          :key="item.path"
          class="nav-tab"
          :class="{ active: route.path === item.path }"
          type="button"
          :title="item.label"
          @click="router.push(item.path)"
        >
          <component :is="item.icon" :size="15" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
      <div v-else class="topbar-title">{{ t("pending.title") }}</div>

      <nav class="topbar-actions">
        <ThemeToggle />
        <LocaleSwitcher />
        <button
          v-if="canManageShares"
          class="icon-button"
          :class="{ active: route.path === '/shares' }"
          type="button"
          :title="t('nav.shares')"
          @click="router.push('/shares')"
        >
          <Link2 :size="18" />
        </button>
        <button
          v-if="canManageUsers"
          class="icon-button"
          :class="{ active: route.path === '/users' }"
          type="button"
          :title="t('nav.users')"
          @click="router.push('/users')"
        >
          <UserCog :size="18" />
        </button>
        <button
          class="icon-button"
          :class="{ active: route.path === '/profile' }"
          type="button"
          :title="t('nav.profile')"
          @click="router.push('/profile')"
        >
          <Settings :size="18" />
        </button>
        <button class="icon-button" type="button" :title="t('nav.logout')" @click="logout">
          <LogOut :size="18" />
        </button>
      </nav>
    </header>

    <RouterView v-slot="{ Component }">
      <Transition name="page-fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </div>
</template>

<style scoped>
.primary-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel-2);
}

.nav-tab {
  height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.nav-tab:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.nav-tab.active {
  background: var(--accent);
  color: var(--accent-contrast);
}

.nav-tab:active {
  transform: scale(0.97);
}

@media (max-width: 760px) {
  .brand span {
    display: none;
  }

  .nav-tab {
    padding: 0 9px;
  }

  .nav-tab span {
    display: none;
  }
}
</style>
