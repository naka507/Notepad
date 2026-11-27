<script setup lang="ts">
import type { PublicSharePayload, SheetWorkbook } from "@notepad/core"
import { Check, Copy, Download, File as FileIcon, FileSpreadsheet, FileText, Loader2, Lock } from "@lucide/vue"
import { computed, onMounted, ref } from "vue"
import { useRoute } from "vue-router"
import { api } from "@/api/client"
import DocEditor from "@/components/DocEditor.vue"
import LocaleSwitcher from "@/components/LocaleSwitcher.vue"
import SheetEditor from "@/components/SheetEditor.vue"
import ThemeToggle from "@/components/ThemeToggle.vue"
import { formatDateTime, t } from "@/i18n"
import { formatBytes, formatRemainingTime, renderSafeMarkdown } from "@/utils/format"

const route = useRoute()
const code = computed(() => String(route.params.code || ""))

const loading = ref(true)
const share = ref<PublicSharePayload | null>(null)
const error = ref("")
const password = ref("")
const unlocking = ref(false)
const copied = ref(false)

const renderedHtml = computed(() => (share.value?.note ? renderSafeMarkdown(share.value.note.content) : ""))

function isImage(mime: string) {
  return ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"].includes(
    mime.toLowerCase()
  )
}

async function loadShare() {
  loading.value = true
  error.value = ""
  try {
    share.value = (await api.getPublicShare(code.value)).share
  } catch {
    share.value = null
    error.value = t("public.unavailable")
  } finally {
    loading.value = false
  }
}

async function unlock() {
  unlocking.value = true
  error.value = ""
  try {
    await api.verifyPublicShare(code.value, password.value)
    await loadShare()
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Invalid password"
  } finally {
    unlocking.value = false
  }
}

async function copyNote() {
  if (!share.value?.note) return
  await navigator.clipboard.writeText(share.value.note.content)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1500)
}

onMounted(loadShare)
</script>

<template>
  <main class="public-page">
    <div class="public-top">
      <div class="public-brand">
        <img src="/favicon.svg" alt="Notepad" class="brand-logo" />
        <span>Notepad</span>
      </div>
      <div class="public-tools">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>
    </div>

    <section v-if="loading" class="public-card center">
      <Loader2 class="spin" :size="22" />
    </section>

    <section v-else-if="!share" class="public-card center">
      <Lock :size="26" />
      <p class="muted">{{ error || t("public.unavailable") }}</p>
    </section>

    <section v-else-if="share.requiresPassword" class="public-card center">
      <Lock :size="24" />
      <h1>{{ t("public.passwordTitle") }}</h1>
      <form class="unlock-form" @submit.prevent="unlock">
        <input
          v-model="password"
          class="input"
          type="password"
          :placeholder="t('public.passwordPlaceholder')"
          required
        />
        <p v-if="error" class="error">{{ error }}</p>
        <button class="button" type="submit" :disabled="unlocking">
          {{ t("public.unlock") }}
        </button>
      </form>
    </section>

    <article v-else-if="share.targetType === 'note' && share.note" class="public-card note-card">
      <header class="card-head">
        <div>
          <h1>{{ share.note.title || t("ws.noteTitle") }}</h1>
          <p class="muted">
            {{ formatRemainingTime(share.expiresAt) }}
            <template v-if="share.expiresAt"> · {{ t("public.expiresAt", { time: formatDateTime(share.expiresAt) }) }}</template>
          </p>
        </div>
        <button class="ghost-button" type="button" @click="copyNote">
          <Check v-if="copied" :size="15" />
          <Copy v-else :size="15" />
          {{ copied ? t("common.copied") : t("public.copyContent") }}
        </button>
      </header>
      <div class="markdown-body" v-html="renderedHtml" />
    </article>

    <article v-else-if="share.targetType === 'document' && share.document" class="public-card doc-card">
      <header class="card-head">
        <div class="file-head">
          <FileText v-if="share.document.docType === 'doc'" :size="20" />
          <FileSpreadsheet v-else :size="20" />
          <div>
            <h1>{{ share.document.title || t("ws.noteTitle") }}</h1>
            <p class="muted">
              {{ formatRemainingTime(share.expiresAt) }}
              <template v-if="share.expiresAt"> · {{ t("public.expiresAt", { time: formatDateTime(share.expiresAt) }) }}</template>
            </p>
          </div>
        </div>
      </header>
      <div class="public-doc-body">
        <DocEditor
          v-if="share.document.docType === 'doc'"
          :model-value="share.document.content"
          :title="share.document.title"
          readonly
          :allow-export="share.permission === 'download'"
        />
        <SheetEditor
          v-else
          :model-value="(share.document.content as unknown as SheetWorkbook)"
          :title="share.document.title"
          readonly
          :allow-export="share.permission === 'download'"
        />
      </div>
    </article>

    <article v-else-if="share.targetType === 'file' && share.file" class="public-card file-card">
      <header class="card-head">
        <div class="file-head">
          <FileIcon :size="20" />
          <div>
            <h1>{{ share.file.filename }}</h1>
            <p class="muted">
              {{ formatBytes(share.file.size) }} · {{ formatRemainingTime(share.expiresAt) }}
            </p>
          </div>
        </div>
        <a
          v-if="share.permission === 'download'"
          class="button link-btn"
          :href="api.publicShareDownloadUrl(share.shareCode)"
          download
        >
          <Download :size="15" />
          {{ t("public.download") }}
        </a>
      </header>

      <div v-if="share.file.previewable && isImage(share.file.mimeType)" class="preview-wrap">
        <img :src="api.publicShareDownloadUrl(share.shareCode, true)" :alt="share.file.filename" />
      </div>
      <iframe
        v-else-if="share.file.previewable && share.file.mimeType === 'application/pdf'"
        :src="api.publicShareDownloadUrl(share.shareCode, true)"
        class="pdf-frame"
      />
    </article>
  </main>
</template>

<style scoped>
.public-page {
  min-height: 100vh;
  width: min(1040px, calc(100% - 32px));
  margin: 0 auto;
  padding: 20px 0 40px;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-content: start;
}

.public-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.public-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 750;
}

.public-tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.public-card {
  min-width: 0;
  max-width: 100%;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 24px;
}

.public-card.center {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 40px 24px;
  text-align: center;
}

.public-card h1 {
  margin: 0;
  font-size: 19px;
}

.unlock-form {
  width: min(320px, 100%);
  display: grid;
  gap: 10px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-bottom: 14px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.card-head p {
  margin: 4px 0 0;
  font-size: 12px;
}

.file-head {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.link-btn {
  text-decoration: none;
}

.preview-wrap {
  display: grid;
  place-items: center;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}

.preview-wrap img {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 6px;
}

.pdf-frame {
  width: 100%;
  height: 72vh;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.public-doc-body {
  min-width: 0;
  max-width: 100%;
  min-height: 420px;
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}
</style>
