<script setup lang="ts">
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import Table from "@tiptap/extension-table"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import TableRow from "@tiptap/extension-table-row"
import TaskItem from "@tiptap/extension-task-item"
import TaskList from "@tiptap/extension-task-list"
import TextAlign from "@tiptap/extension-text-align"
import Underline from "@tiptap/extension-underline"
import StarterKit from "@tiptap/starter-kit"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  CheckSquare,
  Code2,
  Download,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  Upload
} from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { onBeforeUnmount, ref, watch } from "vue"
import { t } from "@/i18n"
import { downloadBlob, exportTiptapToDocx, importDocxToHtml } from "@/utils/docConverters"

const props = withDefaults(
  defineProps<{
    modelValue: Record<string, unknown>
    title?: string
    readonly?: boolean
    allowExport?: boolean
  }>(),
  {
    title: "document",
    readonly: false,
    allowExport: true
  }
)

const emit = defineEmits<{
  "update:modelValue": [value: Record<string, unknown>]
}>()

const docxInput = ref<HTMLInputElement | null>(null)
const exporting = ref(false)
const importing = ref(false)
let suppressNextEmit = false

const editor = useEditor({
  editable: !props.readonly,
  content: props.modelValue,
  extensions: [
    StarterKit,
    Underline,
    Highlight,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: t("docs.docPlaceholder") })
  ],
  onUpdate({ editor: instance }) {
    if (suppressNextEmit) return
    emit("update:modelValue", instance.getJSON() as Record<string, unknown>)
  }
})

watch(
  () => props.readonly,
  (isReadonly) => {
    editor.value?.setEditable(!isReadonly)
  }
)

watch(
  () => props.modelValue,
  (next) => {
    const instance = editor.value
    if (!instance) return
    const currentStr = JSON.stringify(instance.getJSON())
    const nextStr = JSON.stringify(next)
    if (currentStr !== nextStr) {
      suppressNextEmit = true
      instance.commands.setContent(next, false)
      suppressNextEmit = false
    }
  }
)

async function handleImportDocx(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !editor.value) return
  importing.value = true
  try {
    const html = await importDocxToHtml(file)
    editor.value.commands.setContent(html, true)
    ElMessage.success(t("docs.imported"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Import failed")
  } finally {
    importing.value = false
    if (docxInput.value) docxInput.value.value = ""
  }
}

async function handleExportDocx() {
  const json = (editor.value?.getJSON() as Record<string, unknown>) ?? props.modelValue
  exporting.value = true
  try {
    const blob = await exportTiptapToDocx(props.title || "document", json)
    const safeName = (props.title || "document").replace(/[\\/:*?"<>|]+/g, "_")
    downloadBlob(blob, `${safeName}.docx`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Export failed")
  } finally {
    exporting.value = false
  }
}

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="doc-editor">
    <div v-if="!readonly && editor" class="format-bar">
      <div class="tool-group">
        <button class="tool-btn" type="button" :title="t('docs.undo')" @click="editor.chain().focus().undo().run()">
          <Undo2 :size="15" />
        </button>
        <button class="tool-btn" type="button" :title="t('docs.redo')" @click="editor.chain().focus().redo().run()">
          <Redo2 :size="15" />
        </button>
      </div>

      <span class="sep" />

      <div class="tool-group">
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('heading', { level: 1 }) }"
          type="button"
          title="H1"
          @click="editor.chain().focus().toggleHeading({ level: 1 }).run()"
        >
          <Heading1 :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('heading', { level: 2 }) }"
          type="button"
          title="H2"
          @click="editor.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          <Heading2 :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('heading', { level: 3 }) }"
          type="button"
          title="H3"
          @click="editor.chain().focus().toggleHeading({ level: 3 }).run()"
        >
          <Heading3 :size="15" />
        </button>
      </div>

      <span class="sep" />

      <div class="tool-group">
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('bold') }"
          type="button"
          title="Bold"
          @click="editor.chain().focus().toggleBold().run()"
        >
          <Bold :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('italic') }"
          type="button"
          title="Italic"
          @click="editor.chain().focus().toggleItalic().run()"
        >
          <Italic :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('underline') }"
          type="button"
          title="Underline"
          @click="editor.chain().focus().toggleUnderline().run()"
        >
          <UnderlineIcon :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('strike') }"
          type="button"
          title="Strike"
          @click="editor.chain().focus().toggleStrike().run()"
        >
          <Strikethrough :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('highlight') }"
          type="button"
          title="Highlight"
          @click="editor.chain().focus().toggleHighlight().run()"
        >
          <Highlighter :size="15" />
        </button>
      </div>

      <span class="sep" />

      <div class="tool-group">
        <button
          class="tool-btn"
          :class="{ active: editor.isActive({ textAlign: 'left' }) }"
          type="button"
          title="Left"
          @click="editor.chain().focus().setTextAlign('left').run()"
        >
          <AlignLeft :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive({ textAlign: 'center' }) }"
          type="button"
          title="Center"
          @click="editor.chain().focus().setTextAlign('center').run()"
        >
          <AlignCenter :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive({ textAlign: 'right' }) }"
          type="button"
          title="Right"
          @click="editor.chain().focus().setTextAlign('right').run()"
        >
          <AlignRight :size="15" />
        </button>
      </div>

      <span class="sep" />

      <div class="tool-group">
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('bulletList') }"
          type="button"
          title="Bullet List"
          @click="editor.chain().focus().toggleBulletList().run()"
        >
          <List :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('orderedList') }"
          type="button"
          title="Ordered List"
          @click="editor.chain().focus().toggleOrderedList().run()"
        >
          <ListOrdered :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('taskList') }"
          type="button"
          title="Checklist"
          @click="editor.chain().focus().toggleTaskList().run()"
        >
          <CheckSquare :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('blockquote') }"
          type="button"
          title="Quote"
          @click="editor.chain().focus().toggleBlockquote().run()"
        >
          <Quote :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('codeBlock') }"
          type="button"
          title="Code"
          @click="editor.chain().focus().toggleCodeBlock().run()"
        >
          <Code2 :size="15" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: editor.isActive('table') }"
          type="button"
          :title="t('docs.insertTable')"
          @click="editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
        >
          <TableIcon :size="15" />
        </button>
      </div>

      <div v-if="editor.isActive('table')" class="tool-group table-ops">
        <button class="text-tool" type="button" @click="editor.chain().focus().addRowAfter().run()">
          +{{ t("docs.row") }}
        </button>
        <button class="text-tool" type="button" @click="editor.chain().focus().addColumnAfter().run()">
          +{{ t("docs.col") }}
        </button>
        <button class="text-tool danger" type="button" @click="editor.chain().focus().deleteTable().run()">
          {{ t("common.delete") }}
        </button>
      </div>

      <div class="tool-group io-group">
        <input ref="docxInput" type="file" accept=".docx" hidden @change="handleImportDocx" />
        <button class="text-tool" type="button" :disabled="importing" @click="docxInput?.click()">
          <Upload :size="13" />
          .docx
        </button>
        <button class="text-tool" type="button" :disabled="exporting" @click="handleExportDocx">
          <Download :size="13" />
          .docx
        </button>
      </div>
    </div>

    <div v-else-if="readonly && allowExport" class="readonly-bar">
      <button class="ghost-button small-export" type="button" :disabled="exporting" @click="handleExportDocx">
        <Download :size="14" />
        {{ t("docs.exportWord") }}
      </button>
    </div>

    <div class="paper-scroll" :class="{ readonly }">
      <div class="paper-sheet">
        <EditorContent v-if="editor" :editor="editor" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.doc-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.format-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}

.readonly-bar {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel-2);
}

.small-export {
  min-height: 30px;
  font-size: 12px;
  padding: 0 10px;
}

.tool-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.io-group {
  margin-left: auto;
  gap: 6px;
}

.sep {
  width: 1px;
  height: 18px;
  background: var(--line);
}

.tool-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.tool-btn:hover {
  background: var(--surface-hover);
}

.tool-btn.active {
  background: var(--accent);
  color: var(--accent-contrast);
}

.text-tool {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.text-tool:hover {
  border-color: var(--accent);
}

.text-tool.danger {
  color: var(--danger);
}

.paper-scroll {
  flex: 1;
  overflow: auto;
  padding: 20px 24px;
  background: var(--panel-2);
}

.paper-scroll.readonly {
  padding: 16px;
  background: var(--panel);
}

.paper-sheet {
  width: min(820px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 28px 36px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}

.paper-scroll.readonly .paper-sheet {
  border: 0;
  padding: 4px 0;
}

:deep(.ProseMirror) {
  outline: none;
  min-height: 360px;
  font-size: 14px;
  line-height: 1.75;
  color: var(--text);
}

:deep(.ProseMirror p.is-editor-empty:first-child::before) {
  content: attr(data-placeholder);
  float: left;
  color: #a1a1aa;
  pointer-events: none;
  height: 0;
}

:deep(.ProseMirror h1),
:deep(.ProseMirror h2),
:deep(.ProseMirror h3) {
  margin: 1em 0 0.45em;
  line-height: 1.3;
}

:deep(.ProseMirror blockquote) {
  margin: 0.7em 0;
  padding: 4px 12px;
  border-left: 3px solid var(--accent);
  background: var(--panel-2);
  color: var(--muted);
}

:deep(.ProseMirror pre) {
  padding: 12px;
  border-radius: 6px;
  background: var(--surface-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  overflow: auto;
}

:deep(.ProseMirror mark) {
  background: var(--mark-bg);
  color: var(--mark-text);
  padding: 0 2px;
  border-radius: 2px;
}

:deep(.ProseMirror table) {
  border-collapse: collapse;
  width: 100%;
  margin: 0.9em 0;
  table-layout: fixed;
}

:deep(.ProseMirror th),
:deep(.ProseMirror td) {
  border: 1px solid var(--line-strong);
  padding: 6px 8px;
  vertical-align: top;
}

:deep(.ProseMirror th) {
  background: var(--surface-hover);
  font-weight: 700;
}

:deep(.ProseMirror ul[data-type="taskList"]) {
  list-style: none;
  padding: 0;
}

:deep(.ProseMirror ul[data-type="taskList"] li) {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

:deep(.ProseMirror ul[data-type="taskList"] li > label) {
  margin-top: 3px;
}

@media (max-width: 760px) {
  .paper-scroll {
    padding: 10px;
  }

  .paper-sheet {
    padding: 16px;
  }
}
</style>
