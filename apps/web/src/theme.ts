import { computed, ref, watch } from "vue"

export type ThemeMode = "light" | "dark"

const STORAGE_KEY = "notepad_theme"

function initialTheme(): ThemeMode {
  if (typeof window === "undefined") return "light"
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    // ignore storage errors
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export const theme = ref<ThemeMode>(initialTheme())
export const isDark = computed(() => theme.value === "dark")

function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.dataset.theme = mode
  root.classList.toggle("dark", mode === "dark")
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute("content", mode === "dark" ? "#09090b" : "#f5f5f5")
  }
}

watch(
  theme,
  (mode) => {
    applyTheme(mode)
  },
  { immediate: true }
)

export function toggleTheme() {
  const next: ThemeMode = theme.value === "dark" ? "light" : "dark"
  theme.value = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore storage errors
  }
}
