<script setup lang="ts">
import { ROLES } from "@notepad/core"
import {
  BookOpen,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  HardDrive,
  Link2,
  Shield,
  ShieldCheck,
  Smartphone
} from "@lucide/vue"
import { ElDialog } from "element-plus/es/components/dialog/index"
import { computed, ref, type Component } from "vue"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  "update:modelValue": [value: boolean]
}>()

const UiDialog = ElDialog as unknown as Component
const auth = useAuthStore()
const isAdmin = computed(() => auth.user?.role === ROLES.ADMIN)
const activeTab = ref<"roles" | "features" | "account">("roles")
const visibleTab = computed<"roles" | "features" | "account">(() =>
  isAdmin.value ? activeTab.value : "features"
)
</script>

<template>
  <UiDialog
    :model-value="modelValue"
    width="720px"
    align-center
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="dialog-title">
        <BookOpen :size="18" />
        <span>{{ t("help.title") }}</span>
      </div>
    </template>

    <div class="help-body">
      <div v-if="isAdmin" class="help-tabs" role="tablist">
        <button :class="{ active: activeTab === 'roles' }" type="button" @click="activeTab = 'roles'">
          <Shield :size="15" />
          {{ t("help.tabRoles") }}
        </button>
        <button :class="{ active: activeTab === 'features' }" type="button" @click="activeTab = 'features'">
          <FolderKanban :size="15" />
          {{ t("help.tabFeatures") }}
        </button>
        <button :class="{ active: activeTab === 'account' }" type="button" @click="activeTab = 'account'">
          <Smartphone :size="15" />
          {{ t("help.tabAccount") }}
        </button>
      </div>

      <Transition name="page-fade" mode="out-in">
        <div v-if="visibleTab === 'roles'" key="roles" class="help-section">
          <div class="role-grid">
            <div class="help-card">
              <span class="badge">{{ t("role.pending") }}</span>
              <p>{{ t("help.rolePendingDesc") }}</p>
            </div>
            <div class="help-card">
              <span class="badge">{{ t("role.user") }}</span>
              <p>{{ t("help.roleUserDesc") }}</p>
            </div>
            <div class="help-card">
              <span class="badge">{{ t("role.member") }}</span>
              <p>{{ t("help.roleMemberDesc") }}</p>
            </div>
            <div class="help-card">
              <span class="badge dark">{{ t("role.admin") }}</span>
              <p>{{ t("help.roleAdminDesc") }}</p>
            </div>
          </div>
          <div class="help-note">
            <strong>{{ t("help.downgradeTitle") }}</strong>
            <p>{{ t("help.downgradeDesc") }}</p>
          </div>
        </div>

        <div v-else-if="visibleTab === 'features'" key="features" class="help-section">
          <div class="feature-row">
            <FileText :size="18" />
            <div>
              <strong>{{ t("help.notesTitle") }}</strong>
              <p>{{ t("help.notesDesc") }}</p>
            </div>
          </div>
          <div class="feature-row">
            <FileSpreadsheet :size="18" />
            <div>
              <strong>{{ t("help.docsTitle") }}</strong>
              <p>{{ t("help.docsDesc") }}</p>
            </div>
          </div>
          <div class="feature-row">
            <HardDrive :size="18" />
            <div>
              <strong>{{ t("help.filesTitle") }}</strong>
              <p>{{ t("help.filesDesc") }}</p>
            </div>
          </div>
          <div class="feature-row">
            <Link2 :size="18" />
            <div>
              <strong>{{ t("help.shareTitle") }}</strong>
              <p>{{ t("help.shareDesc") }}</p>
            </div>
          </div>
          <div class="feature-row">
            <ShieldCheck :size="18" />
            <div>
              <strong>{{ t("help.roadmapTitle") }}</strong>
              <p>{{ t("help.roadmapDesc") }}</p>
            </div>
          </div>
        </div>

        <div v-else key="account" class="help-section">
          <div class="feature-row">
            <Shield :size="18" />
            <div>
              <strong>{{ t("help.accountTitle") }}</strong>
              <p>{{ t("help.accountDesc") }}</p>
            </div>
          </div>
          <div class="feature-row">
            <Smartphone :size="18" />
            <div>
              <strong>{{ t("help.roadmapTitle") }}</strong>
              <p>{{ t("help.roadmapDesc") }}</p>
            </div>
          </div>
        </div>
      </Transition>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <button class="button" type="button" @click="emit('update:modelValue', false)">
          {{ t("common.ok") }}
        </button>
      </div>
    </template>
  </UiDialog>
</template>

<style scoped>
.help-body {
  display: grid;
  gap: 14px;
}

.help-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.help-tabs button {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.help-tabs button.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--surface-hover);
}

.help-section {
  display: grid;
  gap: 10px;
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.help-card,
.help-note,
.feature-row {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  background: var(--panel-2);
}

.help-card p,
.help-note p,
.feature-row p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}

.badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--surface-strong);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}

.badge.dark {
  background: var(--accent);
  color: var(--accent-contrast);
}

.feature-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.feature-row svg {
  margin-top: 2px;
  color: var(--accent);
}

.feature-row strong,
.help-note strong {
  font-size: 13px;
  color: var(--text);
}

@media (max-width: 640px) {
  .role-grid {
    grid-template-columns: 1fr;
  }
}
</style>
