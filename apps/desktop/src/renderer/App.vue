<script setup lang="ts">
import { PERMISSIONS } from "@notepad/core"
import {
  FileSpreadsheet,
  FileText,
  HardDrive,
  Link2,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Settings,
  ShieldCheck,
  StickyNote,
  UserCog
} from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue"
import CommandPalette, { type PaletteTarget } from "@/components/CommandPalette.vue"
import DesktopTitlebar from "@/components/DesktopTitlebar.vue"
import LocaleSwitcher from "@web/components/LocaleSwitcher.vue"
import ThemeToggle from "@web/components/ThemeToggle.vue"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"
import DesktopDocsPane from "@/views/DesktopDocsPane.vue"
import DesktopFilesPane from "@/views/DesktopFilesPane.vue"
import DesktopLoginView from "@/views/DesktopLoginView.vue"
import DesktopNotesPane from "@/views/DesktopNotesPane.vue"
import DesktopProfilePane from "@/views/DesktopProfilePane.vue"
import DesktopSharesPane from "@/views/DesktopSharesPane.vue"
import DesktopTotpPane from "@/views/DesktopTotpPane.vue"
import DesktopUsersPane from "@/views/DesktopUsersPane.vue"

type DeskTab = "notes" | "docs" | "sheets" | "files" | "totp" | "shares" | "users" | "profile"

const auth = useAuthStore()
const sync = useSyncStore()

const activeTab = ref<DeskTab>("notes")
const paletteOpen = ref(false)
const notesRef = ref<InstanceType<typeof DesktopNotesPane> | null>(null)
const docsRef = ref<InstanceType<typeof DesktopDocsPane> | null>(null)
const sheetsRef = ref<InstanceType<typeof DesktopDocsPane> | null>(null)
const filesRef = ref<InstanceType<typeof DesktopFilesPane> | null>(null)
const totpRef = ref<InstanceType<typeof DesktopTotpPane> | null>(null)

let unsubOAuth: (() => void) | null = null
let unsubQuick: (() => void) | null = null
let syncTimer: number | undefined

const canManageShares = computed(() => auth.hasPermission(PERMISSIONS.SHARE_MANAGE))
const canManageUsers = computed(() => auth.hasPermission(PERMISSIONS.USER_MANAGE))

const railPrimary = computed(() => {
  const items: Array<{ id: DeskTab; label: string; shortcut: string; icon: unknown }> = [
    { id: "notes", label: t("nav.notes"), shortcut: "Ctrl+1", icon: StickyNote },
    { id: "docs", label: t("nav.docs"), shortcut: "Ctrl+2", icon: FileText },
    { id: "sheets", label: t("nav.sheets"), shortcut: "Ctrl+3", icon: FileSpreadsheet },
    { id: "files", label: t("nav.files"), shortcut: "Ctrl+4", icon: HardDrive },
    { id: "totp", label: t("nav.totp"), shortcut: "Ctrl+5", icon: ShieldCheck }
  ]
  if (canManageShares.value) {
    items.push({ id: "shares", label: t("nav.shares"), shortcut: "Ctrl+6", icon: Link2 })
  }
  if (canManageUsers.value) {
    items.push({ id: "users", label: t("nav.users"), shortcut: "Ctrl+7", icon: UserCog })
  }
  return items
})

const sectionTitle = computed(() => {
  if (!auth.user) return ""
  if (!auth.hasWorkspaceAccess && activeTab.value !== "profile") return t("pending.title")
  const map: Record<DeskTab, string> = {
    notes: t("nav.notes"),
    docs: t("nav.docs"),
    sheets: t("nav.sheets"),
    files: t("nav.files"),
    totp: t("nav.totp"),
    shares: t("nav.shares"),
    users: t("nav.users"),
    profile: t("nav.profile")
  }
  return map[activeTab.value]
})

async function handlePaletteSelect(target: PaletteTarget) {
  if (target.type === "action") {
    if (target.id === "new-note") {
      activeTab.value = "notes"
      await nextTick()
      void notesRef.value?.createNew()
    } else if (target.id === "new-doc") {
      activeTab.value = "docs"
      await nextTick()
      void docsRef.value?.createNew()
    } else if (target.id === "new-sheet") {
      activeTab.value = "sheets"
      await nextTick()
      void sheetsRef.value?.createNew()
    } else if (target.id === "sync") {
      void sync.syncNow()
    }
    return
  }

  if (target.type === "note") {
    activeTab.value = "notes"
    await nextTick()
    void notesRef.value?.openById(target.id)
  } else if (target.type === "doc") {
    activeTab.value = "docs"
    await nextTick()
    void docsRef.value?.openById(target.id)
  } else if (target.type === "sheet") {
    activeTab.value = "sheets"
    await nextTick()
    void sheetsRef.value?.openById(target.id)
  } else if (target.type === "file") {
    activeTab.value = "files"
    await nextTick()
    filesRef.value?.openById(target.id)
  } else if (target.type === "totp") {
    activeTab.value = "totp"
  }
}

async function logout() {
  await sync.clearAll()
  await auth.logout()
  activeTab.value = "notes"
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (!auth.hasWorkspaceAccess) return
  const mod = event.ctrlKey || event.metaKey
  if (!mod) return

  if (event.key.toLowerCase() === "k") {
    event.preventDefault()
    paletteOpen.value = !paletteOpen.value
  } else if (event.key === "1") {
    event.preventDefault()
    activeTab.value = "notes"
  } else if (event.key === "2") {
    event.preventDefault()
    activeTab.value = "docs"
  } else if (event.key === "3") {
    event.preventDefault()
    activeTab.value = "sheets"
  } else if (event.key === "4") {
    event.preventDefault()
    activeTab.value = "files"
  } else if (event.key === "5") {
    event.preventDefault()
    activeTab.value = "totp"
  } else if (event.key === "6" && canManageShares.value) {
    event.preventDefault()
    activeTab.value = "shares"
  } else if (event.key === "7" && canManageUsers.value) {
    event.preventDefault()
    activeTab.value = "users"
  } else if (event.key.toLowerCase() === "n" && !event.shiftKey) {
    event.preventDefault()
    if (activeTab.value === "notes") void notesRef.value?.createNew()
    else if (activeTab.value === "docs") void docsRef.value?.createNew()
    else if (activeTab.value === "sheets") void sheetsRef.value?.createNew()
    else if (activeTab.value === "totp") totpRef.value?.createNew()
  }
}

watch(
  () => auth.hasWorkspaceAccess,
  (allowed) => {
    if (allowed) {
      void sync.hydrateFromCache().then(() => sync.syncNow())
    }
  }
)

onMounted(async () => {
  await auth.init()
  if (auth.hasWorkspaceAccess) {
    await sync.hydrateFromCache()
    void sync.syncNow()
  }

  window.addEventListener("keydown", onGlobalKeydown)
  syncTimer = window.setInterval(() => {
    if (auth.hasWorkspaceAccess && document.visibilityState === "visible") {
      void sync.syncNow()
    }
  }, 60_000)

  if (window.notepadDesktop) {
    unsubOAuth = window.notepadDesktop.onOAuthCallback(async (code) => {
      try {
        await auth.exchangeOAuthCode(code)
        ElMessage.success("GitHub 登录成功")
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : "GitHub OAuth failed")
      }
    })
    unsubQuick = window.notepadDesktop.onQuickAction(async (action) => {
      if (!auth.hasWorkspaceAccess) return
      if (action === "new-note") {
        activeTab.value = "notes"
        await nextTick()
        void notesRef.value?.createNew()
      } else if (action === "sync") {
        void sync.syncNow()
      }
    })
  }
})

onUnmounted(() => {
  window.removeEventListener("keydown", onGlobalKeydown)
  if (syncTimer) window.clearInterval(syncTimer)
  unsubOAuth?.()
  unsubQuick?.()
})
</script>

<template>
  <div class="desktop-root">
    <DesktopTitlebar
      :section-title="sectionTitle"
      @open-palette="paletteOpen = true"
      @sync-now="sync.syncNow()"
    />

    <div v-if="!auth.loaded" class="boot-center">
      <Loader2 class="spin" :size="24" />
    </div>

    <DesktopLoginView v-else-if="!auth.user" />

    <div v-else class="desktop-body">
      <!-- Native 56px Left Activity Rail -->
      <nav class="activity-rail" aria-label="Workspace">
        <div v-if="auth.hasWorkspaceAccess" class="rail-group">
          <button
            v-for="item in railPrimary"
            :key="item.id"
            class="rail-btn"
            :class="{ active: activeTab === item.id }"
            type="button"
            :title="`${item.label} (${item.shortcut})`"
            @click="activeTab = item.id"
          >
            <component :is="item.icon" :size="18" />
            <span class="rail-caption">{{ item.label }}</span>
          </button>
        </div>

        <div class="rail-bottom">
          <button
            v-if="auth.hasWorkspaceAccess"
            class="rail-icon"
            type="button"
            :title="t('common.refresh')"
            @click="sync.syncNow()"
          >
            <RefreshCw :class="{ spin: sync.status === 'syncing' }" :size="16" />
          </button>
          <ThemeToggle class="rail-widget" />
          <LocaleSwitcher class="rail-widget" />
          <button
            class="rail-icon"
            :class="{ active: activeTab === 'profile' }"
            type="button"
            :title="t('nav.profile')"
            @click="activeTab = 'profile'"
          >
            <Settings :size="17" />
          </button>
          <button class="rail-icon" type="button" :title="t('nav.logout')" @click="logout">
            <LogOut :size="17" />
          </button>
        </div>
      </nav>

      <!-- Main Edge-to-Edge Workspace Surface -->
      <main class="desktop-stage">
        <div v-if="!auth.hasWorkspaceAccess && activeTab !== 'profile'" class="pending-center">
          <Lock :size="28" class="muted" />
          <h2>{{ t("pending.title") }}</h2>
          <div class="pending-btns">
            <button class="ghost-button" type="button" @click="auth.loadSession()">
              <RefreshCw :size="14" />{{ t("common.refresh") }}
            </button>
            <button class="button" type="button" @click="activeTab = 'profile'">
              <Settings :size="14" />{{ t("pending.settings") }}
            </button>
          </div>
        </div>

        <DesktopNotesPane v-else-if="activeTab === 'notes'" ref="notesRef" />
        <DesktopDocsPane v-else-if="activeTab === 'docs'" ref="docsRef" key="doc" doc-type="doc" />
        <DesktopDocsPane v-else-if="activeTab === 'sheets'" ref="sheetsRef" key="sheet" doc-type="sheet" />
        <DesktopFilesPane v-else-if="activeTab === 'files'" ref="filesRef" />
        <DesktopTotpPane v-else-if="activeTab === 'totp'" ref="totpRef" />
        <DesktopSharesPane v-else-if="activeTab === 'shares'" />
        <DesktopUsersPane v-else-if="activeTab === 'users'" />
        <DesktopProfilePane v-else-if="activeTab === 'profile'" />
      </main>
    </div>

    <CommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @select="handlePaletteSelect"
    />
  </div>
</template>

<style scoped>
.desktop-root {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

.boot-center {
  flex: 1;
  display: grid;
  place-items: center;
}

.desktop-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.activity-rail {
  width: 60px;
  flex-shrink: 0;
  background: var(--panel-2);
  border-right: 1px solid var(--line);
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
}

.rail-group {
  width: 100%;
  display: grid;
  gap: 4px;
}

.rail-btn {
  width: 100%;
  min-height: 46px;
  padding: 5px 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.rail-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.rail-btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
}

.rail-caption {
  font-size: 10px;
  font-weight: 650;
  line-height: 1;
}

.rail-bottom {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}

.rail-icon {
  width: 36px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.rail-icon:hover,
.rail-icon.active {
  background: var(--surface-hover);
  color: var(--text);
}

.rail-icon.active {
  border-color: var(--accent);
}

.rail-widget :deep(.icon-button) {
  width: 36px;
  min-height: 34px;
  border-color: transparent;
  background: transparent;
}

.rail-widget :deep(.icon-button:hover) {
  background: var(--surface-hover);
}

.rail-widget :deep(.locale-menu) {
  top: auto;
  bottom: 0;
  right: auto;
  left: calc(100% + 10px);
}

.desktop-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.pending-center {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
}

.pending-center h2 {
  margin: 0;
  font-size: 18px;
}

.pending-btns {
  display: flex;
  gap: 8px;
}
</style>
