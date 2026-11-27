<script setup lang="ts">
import { ROLES, type AssignableRole, type ManagedUser } from "@notepad/core"
import { Ban, GitBranch, KeyRound, Loader2, RefreshCw, RotateCcw, Trash2, UserCog } from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { onMounted, ref } from "vue"
import { api } from "@/api/client"
import { confirmDialog } from "@/components/confirm"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"
import { formatBytes } from "@/utils/format"

const auth = useAuthStore()
const users = ref<ManagedUser[]>([])
const loading = ref(true)
const error = ref("")

function roleLabel(role: string) {
  return t(`role.${role}`)
}

function displayName(user: ManagedUser) {
  return user.name || user.username || user.email || user.id
}

function isProtectedUser(user: ManagedUser) {
  return user.id === auth.user?.id || user.role === ROLES.ADMIN
}

async function loadUsers() {
  loading.value = true
  error.value = ""
  try {
    users.value = (await api.listUsers()).users
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Error"
  } finally {
    loading.value = false
  }
}

async function changeUserRole(user: ManagedUser, event: Event) {
  const nextRole = (event.target as HTMLSelectElement).value as AssignableRole
  try {
    await api.updateUserRole(user.id, nextRole)
    ElMessage.success(t("users.roleUpdated"))
    await loadUsers()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Error")
    await loadUsers()
  }
}

async function toggleUserStatus(user: ManagedUser) {
  if (isProtectedUser(user)) return
  const disabled = user.disabledAt === null
  const confirmed = await confirmDialog({
    title: disabled ? t("users.disable") : t("users.enable"),
    message: disabled
      ? t("users.confirmDisable", { name: displayName(user) })
      : t("users.confirmEnable", { name: displayName(user) }),
    confirmText: disabled ? t("users.disable") : t("users.enable")
  })
  if (!confirmed) return

  await api.updateUserStatus(user.id, disabled)
  await loadUsers()
}

async function deleteUser(user: ManagedUser) {
  if (isProtectedUser(user)) return
  const confirmed = await confirmDialog({
    title: t("common.delete"),
    message: t("users.confirmDelete", { name: displayName(user) }),
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
  <main class="users-page">
    <section class="users-head">
      <div>
        <h1>
          <UserCog :size="20" />
          {{ t("nav.users") }}
        </h1>
        <p class="muted">{{ t("users.count", { count: users.length }) }}</p>
      </div>
      <button class="icon-button" type="button" :title="t('common.refresh')" @click="loadUsers">
        <RefreshCw :class="{ spin: loading }" :size="16" />
      </button>
    </section>

    <p v-if="error" class="error">{{ error }}</p>

    <section class="users-panel">
      <div class="users-table-head">
        <span>{{ t("users.user") }}</span>
        <span>{{ t("users.usage") }}</span>
        <span>{{ t("users.status") }}</span>
        <span>{{ t("users.actions") }}</span>
      </div>

      <div v-if="loading" class="empty-state">
        <Loader2 class="spin" :size="18" />
      </div>
      <div v-else-if="!users.length" class="empty-state">{{ t("users.empty") }}</div>
      <TransitionGroup v-else tag="div" name="list-slide" class="users-list">
        <div
          v-for="user in users"
          :key="user.id"
          class="user-row"
          :class="{ disabled: user.disabledAt !== null }"
        >
          <div class="user-main">
            <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" />
            <span v-else class="avatar">{{ displayName(user)[0] || "U" }}</span>
            <div class="user-text">
              <span class="user-title">
                <strong>{{ displayName(user) }}</strong>
                <span class="role-pill" :class="{ admin: user.role === 'admin' }">
                  {{ roleLabel(user.role) }}
                </span>
                <KeyRound v-if="user.hasPassword" :size="12" class="auth-icon" title="Password" />
                <GitBranch v-if="user.hasGithub" :size="12" class="auth-icon" title="GitHub" />
              </span>
              <p class="muted">{{ user.username || user.email || user.id }}</p>
            </div>
          </div>

          <div class="user-usage">
            <strong>{{ user.fileCount }} {{ t("ws.files") }} · {{ formatBytes(user.storageBytes) }}</strong>
            <p class="muted">{{ user.noteCount }} {{ t("ws.notes") }}</p>
          </div>

          <span class="status-pill" :class="{ disabled: user.disabledAt !== null }">
            {{ user.disabledAt === null ? t("users.enabled") : t("users.disabled") }}
          </span>

          <div class="user-actions">
            <select
              class="select role-select"
              :value="user.role"
              :disabled="isProtectedUser(user)"
              @change="changeUserRole(user, $event)"
            >
              <option value="admin" disabled>{{ roleLabel("admin") }}</option>
              <option value="member">{{ roleLabel("member") }}</option>
              <option value="user">{{ roleLabel("user") }}</option>
              <option value="pending">{{ roleLabel("pending") }}</option>
            </select>
            <button
              class="ghost-button small"
              type="button"
              :disabled="isProtectedUser(user)"
              @click="toggleUserStatus(user)"
            >
              <component :is="user.disabledAt === null ? Ban : RotateCcw" :size="14" />
              {{ user.disabledAt === null ? t("users.disable") : t("users.enable") }}
            </button>
            <button
              class="danger-button small"
              type="button"
              :disabled="isProtectedUser(user)"
              @click="deleteUser(user)"
            >
              <Trash2 :size="14" />
              {{ t("common.delete") }}
            </button>
          </div>
        </div>
      </TransitionGroup>
    </section>
  </main>
</template>

<style scoped>
.users-page {
  width: min(1440px, calc(100% - 48px));
  margin: 0 auto;
  padding: 18px 0 32px;
  display: grid;
  gap: 16px;
}

.users-head,
.users-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.users-head {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.users-head h1 {
  margin: 0 0 2px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
}

.users-head p {
  margin: 0;
  font-size: 13px;
}

.users-panel {
  overflow: hidden;
}

.users-table-head,
.user-row {
  display: grid;
  grid-template-columns: minmax(250px, 1.3fr) minmax(180px, 1fr) 90px minmax(310px, auto);
  gap: 16px;
  align-items: center;
}

.users-table-head {
  min-height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
}

.user-row {
  min-height: 64px;
  padding: 10px 16px;
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
  width: 36px;
  height: 36px;
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

.user-text strong,
.user-text p,
.user-usage strong,
.user-usage p {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-text p,
.user-usage p {
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

.auth-icon {
  color: var(--muted);
  flex-shrink: 0;
}

.role-pill {
  border-radius: 999px;
  background: var(--surface-hover);
  color: var(--accent-2);
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
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
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.status-pill.disabled {
  color: var(--danger);
  background: var(--danger-bg);
}

.user-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}

.role-select {
  width: 112px;
  height: 30px;
  min-height: 30px;
  line-height: 28px;
  font-size: 12px;
}

.small {
  min-height: 30px;
  font-size: 12px;
}

@media (max-width: 820px) {
  .users-page {
    width: min(100% - 24px, 100%);
  }

  .users-table-head {
    display: none;
  }

  .user-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .user-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
}
</style>
