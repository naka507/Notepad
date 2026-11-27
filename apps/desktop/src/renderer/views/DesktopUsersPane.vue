<script setup lang="ts">
import { ROLES, type AssignableRole, type ManagedUser } from "@notepad/core"
import { Ban, CheckCircle2, GitBranch, KeyRound, Loader2, RefreshCw, Trash2, Users } from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { onMounted, ref } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { t } from "@/i18n"
import { formatBytes } from "@/utils/format"

const users = ref<ManagedUser[]>([])
const loading = ref(true)
const roleOptions: AssignableRole[] = [ROLES.MEMBER, ROLES.USER, ROLES.PENDING]

async function loadUsers() {
  loading.value = true
  try {
    users.value = (await api.listUsers()).users
  } finally {
    loading.value = false
  }
}

async function changeRole(user: ManagedUser, event: Event) {
  const role = (event.target as HTMLSelectElement).value as AssignableRole
  try {
    await api.updateUserRole(user.id, role)
    ElMessage.success(t("users.roleUpdated"))
    await loadUsers()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
  }
}

async function toggleDisable(user: ManagedUser) {
  const nextDisabled = user.disabledAt === null
  const confirmed = await confirmDialog({
    title: nextDisabled ? t("users.disable") : t("users.enable"),
    message: t(nextDisabled ? "users.confirmDisable" : "users.confirmEnable", {
      name: user.name || user.username || user.id
    }),
    confirmText: nextDisabled ? t("users.disable") : t("users.enable"),
    tone: nextDisabled ? "danger" : "default"
  })
  if (!confirmed) return
  await api.updateUserStatus(user.id, nextDisabled)
  await loadUsers()
}

async function deleteUser(user: ManagedUser) {
  const confirmed = await confirmDialog({
    title: t("common.delete"),
    message: t("users.confirmDelete", { name: user.name || user.username || user.id }),
    confirmText: t("common.delete"),
    tone: "danger"
  })
  if (!confirmed) return
  await api.deleteUser(user.id)
  await loadUsers()
}

onMounted(loadUsers)
</script>

<template>
  <div class="desktop-scroll-page">
    <div class="pane-stack">
      <header class="pane-head">
        <div>
          <h1><Users :size="18" />{{ t("nav.users") }}</h1>
          <p class="muted">{{ t("users.count", { count: users.length }) }}</p>
        </div>
        <button class="icon-button compact-icon" type="button" @click="loadUsers">
          <RefreshCw :class="{ spin: loading }" :size="15" />
        </button>
      </header>

      <section class="panel-box">
        <div class="tbl-head">
          <span>{{ t("users.user") }}</span>
          <span>{{ t("users.usage") }}</span>
          <span>{{ t("users.status") }}</span>
          <span>{{ t("users.actions") }}</span>
        </div>

        <div v-if="loading" class="empty-state"><Loader2 class="spin" :size="18" /></div>
        <div v-else-if="!users.length" class="empty-state">{{ t("users.empty") }}</div>
        <div v-for="u in users" :key="u.id" class="user-row" :class="{ disabled: u.disabledAt !== null }">
          <div class="user-main">
            <img v-if="u.avatarUrl" :src="u.avatarUrl" alt="" />
            <div v-else class="avatar">{{ (u.name || u.username || "U")[0] }}</div>
            <div class="user-text">
              <div class="user-title">
                <strong>{{ u.name || u.username }}</strong>
                <span class="role-pill" :class="{ admin: u.role === ROLES.ADMIN }">{{ t(`role.${u.role}`) }}</span>
                <KeyRound v-if="u.hasPassword" :size="12" class="muted" />
                <GitBranch v-if="u.hasGithub" :size="12" class="muted" />
              </div>
              <p class="muted">{{ u.username || u.email }}</p>
            </div>
          </div>

          <div class="user-usage">
            <strong>{{ u.fileCount }} {{ t("nav.files") }} · {{ formatBytes(u.storageBytes) }}</strong>
            <p class="muted">{{ u.noteCount }} {{ t("nav.notes") }}</p>
          </div>

          <span class="status-pill" :class="{ disabled: u.disabledAt !== null }">
            {{ u.disabledAt !== null ? t("users.disabled") : t("users.enabled") }}
          </span>

          <div class="user-actions">
            <template v-if="u.role !== ROLES.ADMIN">
              <select :value="u.role" class="select role-select" @change="changeRole(u, $event)">
                <option v-for="r in roleOptions" :key="r" :value="r">{{ t(`role.${r}`) }}</option>
              </select>
              <button class="ghost-button small" type="button" @click="toggleDisable(u)">
                <CheckCircle2 v-if="u.disabledAt !== null" :size="13" />
                <Ban v-else :size="13" />
                {{ u.disabledAt !== null ? t("users.enable") : t("users.disable") }}
              </button>
              <button class="danger-button small" type="button" @click="deleteUser(u)">
                <Trash2 :size="13" />
              </button>
            </template>
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

.pane-head p {
  margin: 2px 0 0;
  font-size: 12px;
}

.compact-icon {
  width: 30px;
  min-height: 30px;
}

.panel-box {
  overflow: hidden;
}

.tbl-head,
.user-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.3fr) minmax(160px, 1fr) 86px minmax(260px, auto);
  gap: 14px;
  align-items: center;
  padding: 0 16px;
}

.tbl-head {
  min-height: 38px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.user-row {
  min-height: 60px;
  padding-top: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}

.user-row:last-child {
  border-bottom: 0;
}

.user-row.disabled {
  background: var(--panel-2);
}

.user-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.user-main img,
.avatar {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  flex-shrink: 0;
}

.avatar {
  display: grid;
  place-items: center;
  background: var(--surface-hover);
  color: var(--accent);
  font-weight: 800;
  text-transform: uppercase;
}

.user-text,
.user-usage {
  min-width: 0;
}

.user-text p,
.user-usage p {
  margin: 0;
  font-size: 12px;
}

.user-usage strong {
  font-size: 13px;
}

.user-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.role-pill {
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--accent-2);
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 700;
}

.role-pill.admin {
  background: var(--accent);
  color: var(--accent-contrast);
}

.status-pill {
  width: max-content;
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--accent);
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 700;
}

.status-pill.disabled {
  color: var(--danger);
  background: var(--danger-bg);
}

.user-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

.role-select {
  width: 104px;
  height: 28px;
  min-height: 28px;
  line-height: 26px;
  font-size: 12px;
}

.small {
  min-height: 28px;
  font-size: 12px;
}
</style>
