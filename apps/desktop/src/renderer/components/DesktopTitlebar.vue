<script setup lang="ts">
import { Cloud, CloudOff, Copy, Minus, RefreshCw, Search, Square, X } from "@lucide/vue"
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useAuthStore } from "@/stores/auth"
import { useSyncStore } from "@/stores/sync"

defineProps<{
  sectionTitle: string
}>()

const emit = defineEmits<{
  openPalette: []
  syncNow: []
}>()

const auth = useAuthStore()
const sync = useSyncStore()

const isMac = ref(false)
const isMaximized = ref(false)
const isElectron = Boolean(window.notepadDesktop)
let unsubMax: (() => void) | null = null

const syncLabel = computed(() => {
  if (sync.status === "syncing") return "同步中"
  if (sync.status === "offline") return "离线"
  return "已同步"
})

async function minimize() {
  await window.notepadDesktop?.minimize()
}

async function toggleMaximize() {
  if (!window.notepadDesktop) return
  isMaximized.value = await window.notepadDesktop.toggleMaximize()
}

async function closeWindow() {
  await window.notepadDesktop?.close()
}

onMounted(async () => {
  if (!window.notepadDesktop) return
  const [info, max] = await Promise.all([
    window.notepadDesktop.getInfo().catch(() => null),
    window.notepadDesktop.isMaximized().catch(() => false)
  ])
  isMac.value = info?.platform === "darwin"
  isMaximized.value = max
  unsubMax = window.notepadDesktop.onMaximizedChange((val) => {
    isMaximized.value = val
  })
})

onUnmounted(() => {
  unsubMax?.()
})
</script>

<template>
  <header class="desktop-titlebar drag-region" :class="{ mac: isMac }">
    <div class="tb-left">
      <img src="/favicon.svg" alt="Notepad" class="tb-logo" />
      <strong class="tb-brand">Notepad</strong>
      <span v-if="auth.user && sectionTitle" class="tb-sep">/</span>
      <span v-if="auth.user && sectionTitle" class="tb-section">{{ sectionTitle }}</span>

      <button
        v-if="auth.hasWorkspaceAccess"
        class="sync-pill no-drag"
        :class="sync.status"
        type="button"
        title="点击立即同步"
        @click="emit('syncNow')"
      >
        <RefreshCw v-if="sync.status === 'syncing'" :size="12" class="spin" />
        <CloudOff v-else-if="sync.status === 'offline'" :size="12" />
        <Cloud v-else :size="12" />
        <span>{{ syncLabel }}</span>
      </button>
    </div>

    <div v-if="auth.hasWorkspaceAccess" class="tb-center">
      <button class="palette-trigger no-drag" type="button" @click="emit('openPalette')">
        <Search :size="13" />
        <span>搜索笔记、文档、表格、文件、动态码...</span>
        <kbd>Ctrl K</kbd>
      </button>
    </div>
    <div v-else />

    <div class="tb-right no-drag">
      <template v-if="isElectron && !isMac">
        <button class="win-btn" type="button" title="最小化" @click="minimize">
          <Minus :size="14" />
        </button>
        <button class="win-btn" type="button" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
          <Copy v-if="isMaximized" :size="12" />
          <Square v-else :size="12" />
        </button>
        <button class="win-btn close" type="button" title="关闭到托盘" @click="closeWindow">
          <X :size="14" />
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.desktop-titlebar {
  height: 38px;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(240px, 420px) minmax(120px, 1fr);
  align-items: center;
  padding: 0 0 0 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
}

.desktop-titlebar.mac {
  padding-left: 78px;
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tb-logo {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  flex-shrink: 0;
}

.tb-brand {
  font-size: 13px;
  font-weight: 750;
  color: var(--text);
}

.tb-sep {
  color: var(--line-strong);
  font-size: 12px;
}

.tb-section {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  white-space: nowrap;
}

.sync-pill {
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--panel);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 4px;
}

.sync-pill:hover {
  border-color: var(--line-strong);
  color: var(--text);
}

.sync-pill.offline {
  color: var(--warning);
  border-color: var(--warning);
}

.tb-center {
  display: flex;
  justify-content: center;
}

.palette-trigger {
  width: 100%;
  height: 26px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 7px;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.palette-trigger:hover {
  border-color: var(--line-strong);
  color: var(--text);
}

.palette-trigger span {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-trigger kbd {
  font-family: inherit;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-hover);
  color: var(--muted);
}

.tb-right {
  justify-self: end;
  display: flex;
  align-items: stretch;
  height: 100%;
}

.win-btn {
  width: 44px;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 120ms ease, color 120ms ease;
}

.win-btn:hover {
  background: var(--surface-hover);
  color: var(--text);
}

.win-btn.close:hover {
  background: #dc2626;
  color: #ffffff;
}
</style>
