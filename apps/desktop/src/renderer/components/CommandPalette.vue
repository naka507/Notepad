<script setup lang="ts">
import {
  FileSpreadsheet,
  FileText,
  HardDrive,
  Moon,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  StickyNote
} from "@lucide/vue"
import { computed, nextTick, ref, watch } from "vue"
import { useSyncStore } from "@/stores/sync"
import { toggleTheme } from "@/theme"

export interface PaletteTarget {
  type: "note" | "doc" | "sheet" | "file" | "totp" | "action"
  id: string
  title: string
  subtitle?: string
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [target: PaletteTarget]
}>()

const sync = useSyncStore()
const query = ref("")
const activeIdx = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const quickActions: PaletteTarget[] = [
  { type: "action", id: "new-note", title: "新建笔记", subtitle: "快捷键 Ctrl+Shift+N" },
  { type: "action", id: "new-doc", title: "新建 Word 文档", subtitle: "在线富文本文档" },
  { type: "action", id: "new-sheet", title: "新建 Excel 表格", subtitle: "多工作表公式表格" },
  { type: "action", id: "sync", title: "立即增量同步", subtitle: "拉取云端最新变更" },
  { type: "action", id: "theme", title: "切换暗黑 / 浅色模式", subtitle: "即时切换外观" }
]

const results = computed<PaletteTarget[]>(() => {
  const q = query.value.trim().toLowerCase()
  const items: PaletteTarget[] = []

  for (const n of sync.notes) {
    if (n.deletedAt !== null) continue
    if (!q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)) {
      items.push({ type: "note", id: n.id, title: n.title || "无标题", subtitle: n.excerpt || "笔记" })
    }
  }
  for (const d of sync.documents) {
    if (d.deletedAt !== null) continue
    if (!q || d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q)) {
      items.push({
        type: d.docType === "sheet" ? "sheet" : "doc",
        id: d.id,
        title: d.title || "无标题",
        subtitle: d.docType === "sheet" ? "表格" : "文档"
      })
    }
  }
  for (const f of sync.files) {
    if (f.deletedAt !== null) continue
    if (!q || f.filename.toLowerCase().includes(q)) {
      items.push({ type: "file", id: f.id, title: f.filename, subtitle: f.mimeType })
    }
  }
  for (const t of sync.totpEntries) {
    if (t.deletedAt !== null) continue
    if (!q || t.issuer.toLowerCase().includes(q) || t.accountName.toLowerCase().includes(q)) {
      items.push({ type: "totp", id: t.id, title: t.issuer || t.accountName, subtitle: t.accountName })
    }
  }

  const matchedActions = quickActions.filter(
    (a) => !q || a.title.toLowerCase().includes(q) || (a.subtitle?.toLowerCase().includes(q) ?? false)
  )

  return [...(q ? items.slice(0, 14) : items.slice(0, 8)), ...matchedActions]
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      query.value = ""
      activeIdx.value = 0
      void nextTick(() => inputRef.value?.focus())
    }
  }
)

watch(results, () => {
  activeIdx.value = 0
})

function choose(item: PaletteTarget) {
  if (item.type === "action" && item.id === "theme") {
    toggleTheme()
    emit("close")
    return
  }
  emit("select", item)
  emit("close")
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close")
  } else if (event.key === "ArrowDown") {
    event.preventDefault()
    if (results.value.length) activeIdx.value = (activeIdx.value + 1) % results.value.length
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    if (results.value.length) {
      activeIdx.value = (activeIdx.value - 1 + results.value.length) % results.value.length
    }
  } else if (event.key === "Enter") {
    event.preventDefault()
    const target = results.value[activeIdx.value]
    if (target) choose(target)
  }
}
</script>

<template>
  <Transition name="pop-fade">
    <div v-if="open" class="palette-backdrop" @click.self="emit('close')" @keydown="onKeydown">
      <div class="palette-box">
        <div class="palette-input-row">
          <Search :size="16" class="muted" />
          <input
            ref="inputRef"
            v-model="query"
            placeholder="搜索笔记、文档、表格、文件、动态码或输入命令..."
          />
          <kbd>ESC</kbd>
        </div>

        <div class="palette-list">
          <div v-if="!results.length" class="palette-empty muted">无匹配结果</div>
          <button
            v-for="(item, idx) in results"
            :key="`${item.type}-${item.id}`"
            class="palette-item"
            :class="{ active: idx === activeIdx }"
            type="button"
            @mouseenter="activeIdx = idx"
            @click="choose(item)"
          >
            <StickyNote v-if="item.type === 'note'" :size="15" />
            <FileText v-else-if="item.type === 'doc'" :size="15" />
            <FileSpreadsheet v-else-if="item.type === 'sheet'" :size="15" />
            <HardDrive v-else-if="item.type === 'file'" :size="15" />
            <ShieldCheck v-else-if="item.type === 'totp'" :size="15" />
            <RefreshCw v-else-if="item.id === 'sync'" :size="15" />
            <Moon v-else-if="item.id === 'theme'" :size="15" />
            <Plus v-else :size="15" />
            <div class="palette-text">
              <strong>{{ item.title }}</strong>
              <span v-if="item.subtitle" class="muted">{{ item.subtitle }}</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  align-items: start;
  justify-items: center;
  padding-top: 12vh;
}

.palette-box {
  width: min(560px, calc(100vw - 32px));
  background: var(--panel);
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

.palette-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.palette-input-row input {
  flex: 1;
  border: 0;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--text);
}

.palette-input-row kbd {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-hover);
  color: var(--muted);
}

.palette-list {
  max-height: 360px;
  overflow: auto;
  padding: 6px;
}

.palette-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
}

.palette-item {
  width: 100%;
  min-height: 40px;
  padding: 6px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.palette-item.active {
  background: var(--surface-hover);
}

.palette-text {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.palette-text strong {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.palette-text span {
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
</style>
