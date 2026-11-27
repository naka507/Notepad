<script setup lang="ts">
import { Lock, RefreshCw, Settings } from "@lucide/vue"
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { api } from "@/api/client"
import { t } from "@/i18n"
import { useAuthStore } from "@/stores/auth"

const auth = useAuthStore()
const router = useRouter()
const adminContact = ref("")
const checking = ref(false)

async function refreshAccess() {
  checking.value = true
  try {
    await auth.loadSession()
    if (auth.hasWorkspaceAccess) {
      await router.push("/notes")
    }
  } finally {
    checking.value = false
  }
}

onMounted(async () => {
  try {
    const config = await api.config()
    adminContact.value = config.adminContact
  } catch {
    adminContact.value = ""
  }
})
</script>

<template>
  <main class="pending-page">
    <section class="pending-card">
      <div class="pending-icon">
        <Lock :size="24" />
      </div>
      <h1>{{ t("pending.title") }}</h1>
      <p v-if="adminContact" class="contact-pill">
        <span>{{ t("pending.contact") }}:</span>
        <strong>{{ adminContact }}</strong>
      </p>
      <div class="pending-actions">
        <button class="ghost-button" type="button" :disabled="checking" @click="refreshAccess">
          <RefreshCw :class="{ spin: checking }" :size="15" />
          {{ t("common.refresh") }}
        </button>
        <button class="button" type="button" @click="router.push('/profile')">
          <Settings :size="15" />
          {{ t("pending.settings") }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.pending-page {
  min-height: calc(100vh - 64px);
  display: grid;
  place-items: center;
  padding: 24px;
}

.pending-card {
  width: min(380px, 100%);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 28px 24px;
  display: grid;
  justify-items: center;
  gap: 14px;
  text-align: center;
}

.pending-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  background: var(--surface-hover);
  display: grid;
  place-items: center;
  color: var(--accent);
}

.pending-card h1 {
  margin: 0;
  font-size: 18px;
}

.contact-pill {
  margin: 0;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  font-size: 13px;
  color: var(--muted);
  display: inline-flex;
  gap: 6px;
}

.contact-pill strong {
  color: var(--text);
}

.pending-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>
