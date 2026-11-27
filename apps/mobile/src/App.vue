<script setup lang="ts">
import {
  Clock,
  FileText,
  Folder,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  StickyNote,
  User as UserIcon
} from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import BiometricLockOverlay from "@/components/BiometricLockOverlay.vue"
import { currentLocale as locale, t } from "@/i18n"
import { hapticImpact, registerMobileLifecycle, syncStatusBarTheme } from "@/native/bridge"
import { useAuthStore } from "@/stores/auth"
import { useLockStore } from "@/stores/lock"
import { useSyncStore } from "@/stores/sync"
import { theme } from "@/theme"
import MobileDocsView from "@/views/MobileDocsView.vue"
import MobileFilesView from "@/views/MobileFilesView.vue"
import MobileLoginView from "@/views/MobileLoginView.vue"
import MobileNotesView from "@/views/MobileNotesView.vue"
import MobileProfileView from "@/views/MobileProfileView.vue"
import MobileTotpView from "@/views/MobileTotpView.vue"

type MobileTab = "notes" | "docs" | "files" | "totp" | "profile"

const auth = useAuthStore()
const sync = useSyncStore()
const lock = useLockStore()

const activeTab = ref<MobileTab>("notes")
const detailOpen = ref(false)

const notesRef = ref<InstanceType<typeof MobileNotesView> | null>(null)
const docsRef = ref<InstanceType<typeof MobileDocsView> | null>(null)
const filesRef = ref<InstanceType<typeof MobileFilesView> | null>(null)
const profileRef = ref<InstanceType<typeof MobileProfileView> | null>(null)

const isAppLocked = computed(() => auth.isAuthenticated && !auth.isPending && lock.isProtected("app"))

const tabs = computed(() => [
  { id: "notes" as const, label: t("nav.notes"), icon: StickyNote },
  { id: "docs" as const, label: t("nav.docs"), icon: FileText },
  { id: "files" as const, label: t("nav.files"), icon: Folder },
  { id: "totp" as const, label: t("nav.totp"), icon: ShieldCheck },
  { id: "profile" as const, label: locale.value === "zh-CN" ? "我的" : "Me", icon: UserIcon }
])

function switchTab(tab: MobileTab) {
  if (activeTab.value === tab) return
  void hapticImpact("light")
  detailOpen.value = false
  activeTab.value = tab
}

function handleHardwareBack(): boolean {
  if (activeTab.value === "notes" && notesRef.value?.hasOpenDetail()) {
    notesRef.value.closeDetail()
    return true
  }
  if (activeTab.value === "docs" && docsRef.value?.hasOpenDetail()) {
    docsRef.value.closeDetail()
    return true
  }
  if (activeTab.value === "files" && filesRef.value?.hasOpenDetail()) {
    filesRef.value.closeDetail()
    return true
  }
  if (activeTab.value === "profile" && profileRef.value?.hasOpenDetail()) {
    profileRef.value.closeDetail()
    return true
  }
  if (activeTab.value !== "notes") {
    activeTab.value = "notes"
    return true
  }
  return false
}

async function onAuthenticated() {
  await sync.hydrateFromDisk()
  if (!auth.isPending) {
    void sync.pull()
  }
}

async function handleLogout() {
  await auth.logout()
  await sync.clearCache()
  detailOpen.value = false
  activeTab.value = "notes"
}

let disposeLifecycle: (() => void) | null = null

watch(
  theme,
  (mode) => {
    void syncStatusBarTheme(mode)
  },
  { immediate: true }
)

onMounted(async () => {
  void syncStatusBarTheme(theme.value)

  await Promise.all([auth.init(), lock.init(), sync.hydrateFromDisk()])
  if (auth.isAuthenticated && !auth.isPending) {
    void sync.pull()
  }

  disposeLifecycle = registerMobileLifecycle({
    onOAuthCode: async (code) => {
      try {
        await auth.exchangeOAuthCode(code)
        ElMessage.success(t("auth.login"))
        await onAuthenticated()
      } catch (err) {
        ElMessage.error(err instanceof Error ? err.message : t("auth.failed"))
      }
    },
    onBackButton: handleHardwareBack,
    onBackground: () => {
      lock.lockNow()
    },
    onResume: () => {
      if (auth.isAuthenticated && !auth.isPending) {
        void sync.pull()
      }
    }
  })
})

onBeforeUnmount(() => {
  disposeLifecycle?.()
})
</script>

<template>
  <!-- Boot Splash -->
  <div v-if="!auth.initialized" class="boot-screen">
    <img class="boot-logo" src="/favicon.svg" alt="Notepad" />
    <Loader2 class="spin" :size="20" />
  </div>

  <!-- Login Screen -->
  <MobileLoginView v-else-if="!auth.isAuthenticated" @authenticated="onAuthenticated" />

  <!-- Pending Approval Screen -->
  <div v-else-if="auth.isPending" class="pending-screen">
    <div class="m-card pending-card">
      <Clock :size="32" />
      <h2>{{ t("pending.title") }}</h2>
      <p v-if="auth.siteConfig?.adminContact" class="contact-pill">
        {{ t("pending.contact") }}: {{ auth.siteConfig.adminContact }}
      </p>
      <div class="pending-actions">
        <button class="button" type="button" @click="auth.refreshSession()">
          <RefreshCw :size="15" />
          {{ t("common.refresh") }}
        </button>
        <button class="ghost-button" type="button" @click="handleLogout">
          <LogOut :size="15" />
          {{ t("nav.logout") }}
        </button>
      </div>
    </div>
  </div>

  <!-- Main Single-Stack + Bottom 5-Tab Shell -->
  <div v-else class="mobile-shell">
    <BiometricLockOverlay v-if="isAppLocked" />

    <main class="mobile-stage">
      <MobileNotesView
        v-if="activeTab === 'notes'"
        ref="notesRef"
        @detail-change="detailOpen = $event"
      />
      <MobileDocsView
        v-else-if="activeTab === 'docs'"
        ref="docsRef"
        @detail-change="detailOpen = $event"
      />
      <MobileFilesView
        v-else-if="activeTab === 'files'"
        ref="filesRef"
        @detail-change="detailOpen = $event"
      />
      <MobileTotpView v-else-if="activeTab === 'totp'" />
      <MobileProfileView
        v-else-if="activeTab === 'profile'"
        ref="profileRef"
        @detail-change="detailOpen = $event"
        @logout="handleLogout"
      />
    </main>

    <!-- Bottom 5-Tab Bar (hidden when pushed into Detail view) -->
    <nav v-show="!detailOpen" class="mobile-tabbar" aria-label="Main navigation">
      <div class="mobile-tabbar-inner">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="mobile-tab-btn"
          :class="{ active: activeTab === tab.id }"
          @click="switchTab(tab.id)"
        >
          <component :is="tab.icon" :size="20" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.boot-screen,
.pending-screen {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  gap: 14px;
  padding: 20px;
  background: var(--bg);
}

.boot-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
}

.pending-card {
  width: min(360px, 100%);
  padding: 26px 20px;
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.pending-card h2 {
  margin: 4px 0 0;
  font-size: 18px;
}

.pending-card p {
  margin: 0;
  font-size: 13px;
}

.contact-pill {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-size: 12px;
}

.pending-actions {
  width: 100%;
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
</style>
