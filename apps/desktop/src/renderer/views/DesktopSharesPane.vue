<script setup lang="ts">
import type { ShareLink } from "@notepad/core"
import { Ban, Check, Copy, File as FileIcon, FileSpreadsheet, FileText, Link2, Loader2, RefreshCw, StickyNote } from "@lucide/vue"
import { onMounted, ref } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { formatDateTime, t } from "@/i18n"
import { formatBytes, formatRemainingTime } from "@/utils/format"

const shares = ref<ShareLink[]>([])
const loading = ref(true)
const copiedId = ref("")

function shareUrl(code: string) {
  return `${api.serverUrl}/s/${code}`
}

function statusText(share: ShareLink) {
  if (share.revokedAt !== null) return t("share.revoked")
  if (!share.isActive) return t("share.expired")
  return t("share.active")
}

async function loadShares() {
  loading.value = true
  try {
    shares.value = (await api.listShares()).shares
  } finally {
    loading.value = false
  }
}

async function copyLink(share: ShareLink) {
  await navigator.clipboard.writeText(shareUrl(share.shareCode))
  copiedId.value = share.id
  window.setTimeout(() => {
    if (copiedId.value === share.id) copiedId.value = ""
  }, 1500)
}

async function revoke(share: ShareLink) {
  const confirmed = await confirmDialog({
    title: t("share.revoke"),
    message: t("share.confirmRevoke"),
    confirmText: t("share.revoke"),
    tone: "danger"
  })
  if (!confirmed) return
  await api.revokeShare(share.id)
  await loadShares()
}

onMounted(loadShares)
</script>

<template>
  <div class="desktop-scroll-page">
    <div class="pane-stack">
      <header class="pane-head">
        <h1><Link2 :size="18" />{{ t("nav.shares") }}</h1>
        <button class="icon-button compact-icon" type="button" @click="loadShares">
          <RefreshCw :class="{ spin: loading }" :size="15" />
        </button>
      </header>

      <section class="panel-box">
        <div v-if="loading" class="empty-state"><Loader2 class="spin" :size="18" /></div>
        <div v-else-if="!shares.length" class="empty-state">{{ t("share.empty") }}</div>
        <div v-for="share in shares" :key="share.id" class="share-row" :class="{ inactive: !share.isActive }">
          <div class="share-main">
            <StickyNote v-if="share.targetType === 'note'" :size="15" />
            <FileText v-else-if="share.targetType === 'document' && share.targetDocType === 'doc'" :size="15" />
            <FileSpreadsheet v-else-if="share.targetType === 'document'" :size="15" />
            <FileIcon v-else :size="15" />
            <div class="share-info">
              <strong>{{ share.targetTitle }}</strong>
              <p class="muted">
                {{ formatDateTime(share.createdAt) }}
                <template v-if="share.targetSize"> · {{ formatBytes(share.targetSize) }}</template>
                · {{ t("share.views", { count: share.viewCount }) }}
              </p>
            </div>
          </div>

          <span class="pill" :class="{ active: share.isActive }">
            {{ share.isActive ? formatRemainingTime(share.expiresAt) : statusText(share) }}
          </span>

          <div class="share-actions">
            <button v-if="share.isActive" class="ghost-button small" type="button" @click="copyLink(share)">
              <Check v-if="copiedId === share.id" :size="13" />
              <Copy v-else :size="13" />
              {{ copiedId === share.id ? t("common.copied") : t("common.copy") }}
            </button>
            <button v-if="share.isActive" class="danger-button small" type="button" @click="revoke(share)">
              <Ban :size="13" />
              {{ t("share.revoke") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pane-stack {
  display: grid;
  gap: 14px;
}

.pane-head,
.panel-box {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.pane-head {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pane-head h1 {
  margin: 0;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-icon {
  width: 30px;
  min-height: 30px;
}

.panel-box {
  overflow: hidden;
}

.share-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 14px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--line);
}

.share-row:last-child {
  border-bottom: 0;
}

.share-row.inactive {
  opacity: 0.68;
  background: var(--panel-2);
}

.share-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.share-info {
  min-width: 0;
}

.share-info strong,
.share-info p {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.share-info p {
  font-size: 12px;
}

.pill {
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 650;
  background: var(--surface-hover);
  color: var(--muted);
}

.pill.active {
  background: var(--accent);
  color: var(--accent-contrast);
}

.share-actions {
  display: flex;
  gap: 6px;
}

.small {
  min-height: 28px;
  font-size: 12px;
}
</style>
