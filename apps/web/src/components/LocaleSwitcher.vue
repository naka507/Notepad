<script setup lang="ts">
import { Check, Languages } from "@lucide/vue"
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from "vue"
import { currentLocale, localeChoice, t, type LocaleChoice } from "@/i18n"

const root = ref<HTMLElement | ComponentPublicInstance | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const open = ref(false)
const menuStyle = ref<Record<string, string>>({})

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

function updatePosition() {
  const el = rootElement()
  if (!el) return
  const rect = el.getBoundingClientRect()
  const menuW = 148
  const menuH = 116
  const gap = 6
  const vw = window.innerWidth
  const vh = window.innerHeight

  const spaceBelow = vh - rect.bottom
  const openUpward = spaceBelow < menuH + gap + 12 && rect.top > menuH + gap
  const top = openUpward
    ? Math.max(8, rect.top - menuH - gap)
    : Math.min(vh - menuH - 8, rect.bottom + gap)

  let left = rect.right - menuW
  if (left < 8) left = Math.min(vw - menuW - 8, rect.left)
  left = Math.max(8, Math.min(vw - menuW - 8, left))

  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`
  }
}

async function toggle() {
  open.value = !open.value
  if (open.value) {
    updatePosition()
    await nextTick()
    updatePosition()
  }
}

function choose(value: LocaleChoice) {
  localeChoice.value = value
  open.value = false
}

function closeOnOutsideClick(event: MouseEvent) {
  const target = event.target as Node
  const element = rootElement()
  if (element?.contains(target) || menuRef.value?.contains(target)) return
  open.value = false
}

function closeOnViewportChange() {
  if (open.value) open.value = false
}

onMounted(() => {
  document.addEventListener("click", closeOnOutsideClick)
  window.addEventListener("resize", closeOnViewportChange)
  window.addEventListener("scroll", closeOnViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener("click", closeOnOutsideClick)
  window.removeEventListener("resize", closeOnViewportChange)
  window.removeEventListener("scroll", closeOnViewportChange, true)
})
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
      @click="toggle"
      @keydown.escape="open = false"
    >
      <Languages :size="18" />
    </button>

    <Teleport to="body">
      <Transition name="pop-fade">
        <div
          v-if="open"
          ref="menuRef"
          class="locale-menu-portal"
          :style="menuStyle"
          role="listbox"
        >
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
    </Teleport>
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
</style>

<style>
.locale-menu-portal {
  position: fixed;
  z-index: 3200;
  width: 148px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
}

.locale-menu-portal .locale-option {
  width: 100%;
  min-height: 36px;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-out);
}

.locale-menu-portal .locale-option:hover,
.locale-menu-portal .locale-option.active {
  background: var(--surface-hover);
}
</style>
