<script setup lang="ts">
import { Moon, Sun } from "@lucide/vue"
import { computed } from "vue"
import { t } from "@/i18n"
import { isDark, toggleTheme } from "@/theme"

const label = computed(() => (isDark.value ? t("theme.toLight") : t("theme.toDark")))
</script>

<template>
  <button
    class="icon-button theme-toggle"
    type="button"
    :title="label"
    :aria-label="label"
    :aria-pressed="isDark"
    @click="toggleTheme"
  >
    <Transition name="theme-icon" mode="out-in">
      <Sun v-if="isDark" key="sun" :size="18" />
      <Moon v-else key="moon" :size="18" />
    </Transition>
  </button>
</template>

<style scoped>
.theme-toggle {
  flex-shrink: 0;
}

.theme-icon-enter-active,
.theme-icon-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.theme-icon-enter-from {
  opacity: 0;
  transform: rotate(-28deg) scale(0.8);
}

.theme-icon-leave-to {
  opacity: 0;
  transform: rotate(28deg) scale(0.8);
}
</style>
