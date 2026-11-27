<script setup lang="ts">
import {
  ADMIN_SHARE_TTL_PRESETS_SEC,
  DEFAULT_SHARE_TTL_SEC,
  ROLES,
  type ShareLink,
  type ShareTargetType,
  type SiteConfig
} from "@notepad/core"
import { Check, Copy, Link2, Loader2 } from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, ref, watch, type Component } from "vue"
import { api } from "@/api/client"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { formatTtlLabel } from "@/utils/format"

const props = defineProps<{
  modelValue: boolean
  targetType: ShareTargetType
  targetId: string
  targetTitle: string
  siteConfig: SiteConfig | null
}>()

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
  created: [share: ShareLink]
}>()

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()

const ttlSec = ref<number>(DEFAULT_SHARE_TTL_SEC)
const permission = ref<"view" | "download">("download")
const accessPassword = ref("")
const maxViews = ref("")
const creating = ref(false)
const createdShare = ref<ShareLink | null>(null)
const copied = ref(false)

const isAdmin = computed(() => auth.user?.role === ROLES.ADMIN)

const ttlOptions = computed(() => {
  if (isAdmin.value) {
    return [...ADMIN_SHARE_TTL_PRESETS_SEC]
  }
  const configured = props.siteConfig?.share.memberAllowedTtlSec
  return configured?.length ? configured : [900, 3600, 21600, 86400]
})

const shareUrl = computed(() => {
  if (!createdShare.value) return ""
  const base =
    ("serverUrl" in api && typeof api.serverUrl === "string" && api.serverUrl) ||
    (typeof window !== "undefined" ? window.location.origin : "")
  return base ? `${base.replace(/\/+$/g, "")}/s/${createdShare.value.shareCode}` : ""
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      ttlSec.value = props.siteConfig?.share.defaultTtlSec ?? DEFAULT_SHARE_TTL_SEC
      if (!ttlOptions.value.includes(ttlSec.value)) {
        ttlSec.value = ttlOptions.value[0] ?? DEFAULT_SHARE_TTL_SEC
      }
      permission.value = "download"
      accessPassword.value = ""
      maxViews.value = ""
      createdShare.value = null
      copied.value = false
    }
  }
)

async function submit() {
  creating.value = true
  try {
    const parsedMax = maxViews.value.trim() ? Number(maxViews.value.trim()) : null
    const res = await api.createShare({
      targetType: props.targetType,
      targetId: props.targetId,
      ttlSec: ttlSec.value,
      permission: permission.value,
      ...(accessPassword.value.trim() ? { accessPassword: accessPassword.value.trim() } : {}),
      ...(parsedMax && Number.isInteger(parsedMax) && parsedMax > 0 ? { maxViews: parsedMax } : {})
    })
    createdShare.value = res.share
    emit("created", res.share)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : t("common.cancel"))
  } finally {
    creating.value = false
  }
}

async function copyUrl() {
  if (!shareUrl.value) return
  await navigator.clipboard.writeText(shareUrl.value)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <UiDialog
    :model-value="modelValue"
    width="420px"
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="dialog-title">
        <Link2 :size="18" />
        <span>{{ t("share.title") }} · {{ targetTitle }}</span>
      </div>
    </template>

    <div v-if="createdShare" class="created-box">
      <div class="link-row">
        <code>{{ shareUrl }}</code>
        <button class="icon-button" type="button" :title="t('share.copyLink')" @click="copyUrl">
          <Check v-if="copied" :size="16" />
          <Copy v-else :size="16" />
        </button>
      </div>
    </div>

    <form v-else id="create-share-form" class="share-form" @submit.prevent="submit">
      <label>
        <span>{{ t("share.expiry") }}</span>
        <select v-model.number="ttlSec" class="select">
          <option v-for="sec in ttlOptions" :key="sec" :value="sec">
            {{ formatTtlLabel(sec) }}
          </option>
        </select>
      </label>

      <label v-if="targetType === 'file' || targetType === 'document'">
        <span>{{ t("share.permission") }}</span>
        <select v-model="permission" class="select">
          <option value="download">{{ t("share.permDownload") }}</option>
          <option value="view">{{ t("share.permView") }}</option>
        </select>
      </label>

      <label>
        <span>{{ t("share.password") }}</span>
        <input v-model.trim="accessPassword" class="input" type="password" minlength="4" maxlength="64" />
      </label>

      <label>
        <span>{{ t("share.maxViews") }}</span>
        <input v-model.trim="maxViews" class="input" type="number" min="1" max="100000" />
      </label>
    </form>

    <template #footer>
      <div class="dialog-footer">
        <button class="ghost-button" type="button" @click="emit('update:modelValue', false)">
          {{ createdShare ? t("common.close") : t("common.cancel") }}
        </button>
        <button
          v-if="!createdShare"
          class="button"
          type="submit"
          form="create-share-form"
          :disabled="creating"
        >
          <Loader2 v-if="creating" class="spin" :size="15" />
          {{ t("common.create") }}
        </button>
        <button v-else class="button" type="button" @click="copyUrl">
          <Check v-if="copied" :size="15" />
          <Copy v-else :size="15" />
          {{ copied ? t("common.copied") : t("common.copy") }}
        </button>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped>
.share-form {
  display: grid;
  gap: 12px;
}

.share-form label {
  display: grid;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
}

.created-box {
  display: grid;
  gap: 10px;
}

.link-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 8px 6px 10px;
  background: var(--panel-2);
}

.link-row code {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
