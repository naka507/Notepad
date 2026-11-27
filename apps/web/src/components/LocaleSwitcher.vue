<script setup lang="ts">
import { Check, Languages } from "@lucide/vue"
import { computed, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from "vue"
import { currentLocale, localeChoice, t, type LocaleChoice } from "@/i18n"

const root = ref<HTMLElement | ComponentPublicInstance | null>(null)
const open = ref(false)

const options: Array<{ value: LocaleChoice; labelKey: string }> = [
  { value: "auto", labelKey: "locale.auto" },
  { value: "zh-CN", labelKey: "locale.zh" },
  { value: "en-US", labelKey: "locale.en" }
]

const currentLabel = computed(() => {
  if (localeChoice.value === "auto") {
    return `${t("locale.auto")} · ${t(currentLocale.value === "zh-CN" ? "locale.zh" : "locale.en")}`
  }
  return t(localeChoice.value === "zh-CN" ? "locale.zh" : "locale.en")
})

function rootElement(): HTMLElement | null {
  const value = root.value
  if (!value) return null
  return value instanceof HTMLElement ? value : (value.$el as HTMLElement | null)
}

function choose(value: LocaleChoice) {
  localeChoice.value = value
  open.value = false
}

function closeOnOutsideClick(event: MouseEvent) {
  const element = rootElement()
  if (!element || element.contains(event.target as Node)) return
  open.value = false
}

onMounted(() => document.addEventListener("click", closeOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener("click", closeOnOutsideClick))
</script>

<template>
  <div ref="root" class="locale-switcher">
    <button
      class="icon-button locale-trigger"
      type="button"
      :title="currentLabel"
      :aria-label="currentLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
      @keydown.escape="open = false"
    >
      <Languages :size="18" />
    </button>

    <Transition name="pop-fade">
      <div v-if="open" class="locale-menu" role="listbox">
        <button
          v-for="option in options"
          :key="option.value"
          class="locale-option"
          :class="{ active: localeChoice === option.value }"
          type="button"
          role="option"
          :aria-selected="localeChoice === option.value"
          @click="choose(option.value)"
        >
          <span>{{ t(option.labelKey) }}</span>
          <Check v-if="localeChoice === option.value" :size="15" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.locale-switcher {
  position: relative;
  display: inline-flex;
}

.locale-trigger {
  flex-shrink: 0;
}

.locale-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: 148px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: var(--shadow);
}

.locale-option {
  width: 100%;
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 13px;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.locale-option:hover,
.locale-option.active {
  background: var(--surface-hover);
}
</style>
