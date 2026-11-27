<script setup lang="ts">
import type { SheetCell, SheetTab, SheetWorkbook } from "@notepad/core"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowUpDown,
  Bold,
  Download,
  PaintBucket,
  Plus,
  Upload,
  X
} from "@lucide/vue"
import { ElMessage } from "element-plus/es/components/message/index"
import { computed, nextTick, ref, watch } from "vue"
import { t } from "@/i18n"
import { downloadBlob, exportWorkbookToFile, importSpreadsheetFile } from "@/utils/docConverters"
import { cellKey, colIndexToLetter, evaluateCell } from "@/utils/sheetFormula"

const props = withDefaults(
  defineProps<{
    modelValue: SheetWorkbook
    title?: string
    readonly?: boolean
    allowExport?: boolean
  }>(),
  {
    title: "spreadsheet",
    readonly: false,
    allowExport: true
  }
)

const emit = defineEmits<{
  "update:modelValue": [value: SheetWorkbook]
}>()

const sheetInput = ref<HTMLInputElement | null>(null)
const workbook = ref<SheetWorkbook>(normalizeWorkbook(props.modelValue))
const activeRow = ref(0)
const activeCol = ref(0)
const editing = ref(false)
const editBuffer = ref("")
const cellInputRef = ref<HTMLInputElement | null>(null)
const exporting = ref(false)

function normalizeWorkbook(raw: SheetWorkbook | undefined): SheetWorkbook {
  if (raw && Array.isArray(raw.sheets) && raw.sheets.length > 0) {
    return {
      activeSheetId: raw.activeSheetId || raw.sheets[0]!.id,
      sheets: raw.sheets.map((s) => ({
        id: s.id,
        name: s.name || "Sheet",
        rows: Math.max(10, s.rows || 30),
        cols: Math.max(6, s.cols || 12),
        colWidths: { ...(s.colWidths || {}) },
        cells: Object.fromEntries(Object.entries(s.cells || {}).map(([k, v]) => [k, { ...v }]))
      }))
    }
  }
  return {
    activeSheetId: "sheet_1",
    sheets: [{ id: "sheet_1", name: "Sheet1", rows: 30, cols: 12, colWidths: {}, cells: {} }]
  }
}

watch(
  () => props.modelValue,
  (next) => {
    const nextStr = JSON.stringify(next)
    const curStr = JSON.stringify(workbook.value)
    if (nextStr !== curStr) {
      workbook.value = normalizeWorkbook(next)
      activeRow.value = 0
      activeCol.value = 0
      editing.value = false
    }
  }
)

const activeSheet = computed<SheetTab>(() => {
  return (
    workbook.value.sheets.find((s) => s.id === workbook.value.activeSheetId) ?? workbook.value.sheets[0]!
  )
})

const activeKey = computed(() => cellKey(activeRow.value, activeCol.value))
const activeCell = computed<SheetCell>(() => activeSheet.value.cells[activeKey.value] ?? { v: "" })

const formulaValue = computed({
  get: () => (editing.value ? editBuffer.value : activeCell.value.v),
  set: (val: string) => {
    if (props.readonly) return
    setCellRawValue(activeKey.value, val)
  }
})

function emitWorkbook() {
  emit("update:modelValue", normalizeWorkbook(workbook.value))
}

function displayValue(r: number, c: number): string {
  return evaluateCell(cellKey(r, c), activeSheet.value.cells)
}

function getCellStyle(r: number, c: number): Record<string, string> {
  const cell = activeSheet.value.cells[cellKey(r, c)]
  if (!cell) return {}
  const resolvedBg = cell.bg === "#f4f4f5" ? "var(--surface-hover)" : cell.bg
  return {
    ...(cell.bold ? { fontWeight: "700" } : {}),
    ...(cell.align ? { textAlign: cell.align } : {}),
    ...(resolvedBg ? { backgroundColor: resolvedBg } : {})
  }
}

function selectCell(r: number, c: number) {
  if (editing.value) commitEdit()
  activeRow.value = Math.max(0, Math.min(activeSheet.value.rows - 1, r))
  activeCol.value = Math.max(0, Math.min(activeSheet.value.cols - 1, c))
}

function startEdit(initialValue?: string) {
  if (props.readonly) return
  editing.value = true
  editBuffer.value = initialValue !== undefined ? initialValue : activeCell.value.v
  void nextTick(() => {
    cellInputRef.value?.focus()
  })
}

function setCellRawValue(key: string, value: string) {
  const sheet = activeSheet.value
  const existing = sheet.cells[key]
  if (value === "" && (!existing || (!existing.bold && !existing.align && !existing.bg))) {
    delete sheet.cells[key]
  } else {
    sheet.cells[key] = { ...(existing ?? {}), v: value }
  }
  emitWorkbook()
}

function commitEdit() {
  if (!editing.value) return
  editing.value = false
  setCellRawValue(activeKey.value, editBuffer.value)
}

function cancelEdit() {
  editing.value = false
  editBuffer.value = activeCell.value.v
}

function onGridKeydown(event: KeyboardEvent) {
  if (editing.value) {
    if (event.key === "Enter") {
      event.preventDefault()
      commitEdit()
      selectCell(activeRow.value + 1, activeCol.value)
    } else if (event.key === "Tab") {
      event.preventDefault()
      commitEdit()
      selectCell(activeRow.value, activeCol.value + (event.shiftKey ? -1 : 1))
    } else if (event.key === "Escape") {
      event.preventDefault()
      cancelEdit()
    }
    return
  }

  if (event.key === "ArrowDown") {
    event.preventDefault()
    selectCell(activeRow.value + 1, activeCol.value)
  } else if (event.key === "ArrowUp") {
    event.preventDefault()
    selectCell(activeRow.value - 1, activeCol.value)
  } else if (event.key === "ArrowRight" || event.key === "Tab") {
    event.preventDefault()
    selectCell(activeRow.value, activeCol.value + 1)
  } else if (event.key === "ArrowLeft") {
    event.preventDefault()
    selectCell(activeRow.value, activeCol.value - 1)
  } else if (event.key === "Enter" || event.key === "F2") {
    event.preventDefault()
    startEdit()
  } else if ((event.key === "Delete" || event.key === "Backspace") && !props.readonly) {
    event.preventDefault()
    setCellRawValue(activeKey.value, "")
  } else if (
    !props.readonly &&
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault()
    startEdit(event.key)
  }
}

function onPaste(event: ClipboardEvent) {
  if (props.readonly || editing.value) return
  const text = event.clipboardData?.getData("text/plain")
  if (!text) return
  event.preventDefault()
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n")
  const sheet = activeSheet.value
  lines.forEach((line, rOffset) => {
    const cols = line.split("\t")
    cols.forEach((val, cOffset) => {
      const r = activeRow.value + rOffset
      const c = activeCol.value + cOffset
      if (r >= sheet.rows) sheet.rows = Math.min(200, r + 5)
      if (c >= sheet.cols) sheet.cols = Math.min(36, c + 2)
      const key = cellKey(r, c)
      sheet.cells[key] = { ...(sheet.cells[key] ?? {}), v: val }
    })
  })
  emitWorkbook()
}

function toggleBold() {
  if (props.readonly) return
  const sheet = activeSheet.value
  const existing = sheet.cells[activeKey.value] ?? { v: "" }
  sheet.cells[activeKey.value] = { ...existing, bold: !existing.bold }
  emitWorkbook()
}

function setAlign(align: "left" | "center" | "right") {
  if (props.readonly) return
  const sheet = activeSheet.value
  const existing = sheet.cells[activeKey.value] ?? { v: "" }
  sheet.cells[activeKey.value] = { ...existing, align }
  emitWorkbook()
}

function toggleFill() {
  if (props.readonly) return
  const sheet = activeSheet.value
  const existing = sheet.cells[activeKey.value] ?? { v: "" }
  if (existing.bg) {
    const { bg: _bg, ...rest } = existing
    sheet.cells[activeKey.value] = rest
  } else {
    sheet.cells[activeKey.value] = { ...existing, bg: "#f4f4f5" }
  }
  emitWorkbook()
}

function addRows() {
  if (props.readonly) return
  activeSheet.value.rows = Math.min(200, activeSheet.value.rows + 10)
  emitWorkbook()
}

function addCols() {
  if (props.readonly) return
  activeSheet.value.cols = Math.min(36, activeSheet.value.cols + 4)
  emitWorkbook()
}

function sortByActiveCol() {
  if (props.readonly) return
  const sheet = activeSheet.value
  const col = activeCol.value
  const rowData: Array<{ row: number; values: Array<[number, SheetCell]> }> = []

  // Keep row 0 as header if it has non-numeric text, sort rows 1..rows-1
  const startRow = 1
  for (let r = startRow; r < sheet.rows; r += 1) {
    const entries: Array<[number, SheetCell]> = []
    for (let c = 0; c < sheet.cols; c += 1) {
      const cell = sheet.cells[cellKey(r, c)]
      if (cell && cell.v !== "") entries.push([c, cell])
    }
    if (entries.length) rowData.push({ row: r, values: entries })
  }

  rowData.sort((a, b) => {
    const av = a.values.find(([c]) => c === col)?.[1].v ?? ""
    const bv = b.values.find(([c]) => c === col)?.[1].v ?? ""
    const an = Number(av)
    const bn = Number(bv)
    if (av !== "" && bv !== "" && Number.isFinite(an) && Number.isFinite(bn)) return an - bn
    return av.localeCompare(bv)
  })

  for (let r = startRow; r < sheet.rows; r += 1) {
    for (let c = 0; c < sheet.cols; c += 1) {
      delete sheet.cells[cellKey(r, c)]
    }
  }
  rowData.forEach((item, idx) => {
    const targetRow = startRow + idx
    for (const [c, cell] of item.values) {
      sheet.cells[cellKey(targetRow, c)] = cell
    }
  })
  emitWorkbook()
}

function addSheetTab() {
  if (props.readonly) return
  const nextIndex = workbook.value.sheets.length + 1
  const id = `sheet_${Date.now()}`
  workbook.value.sheets.push({
    id,
    name: `Sheet${nextIndex}`,
    rows: 30,
    cols: 12,
    colWidths: {},
    cells: {}
  })
  workbook.value.activeSheetId = id
  activeRow.value = 0
  activeCol.value = 0
  emitWorkbook()
}

function removeSheetTab(id: string) {
  if (props.readonly || workbook.value.sheets.length <= 1) return
  workbook.value.sheets = workbook.value.sheets.filter((s) => s.id !== id)
  if (workbook.value.activeSheetId === id) {
    workbook.value.activeSheetId = workbook.value.sheets[0]!.id
  }
  emitWorkbook()
}

function renameSheetTab(tab: SheetTab) {
  if (props.readonly) return
  const next = window.prompt(t("docs.renameSheet"), tab.name)
  if (next && next.trim()) {
    tab.name = next.trim().slice(0, 31)
    emitWorkbook()
  }
}

async function handleImportSheet(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const imported = await importSpreadsheetFile(file)
    workbook.value = imported
    activeRow.value = 0
    activeCol.value = 0
    emitWorkbook()
    ElMessage.success(t("docs.imported"))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Import failed")
  } finally {
    if (sheetInput.value) sheetInput.value.value = ""
  }
}

async function handleExport(format: "xlsx" | "csv") {
  exporting.value = true
  try {
    const blob = await exportWorkbookToFile(workbook.value, format)
    const safeName = (props.title || "spreadsheet").replace(/[\\/:*?"<>|]+/g, "_")
    downloadBlob(blob, `${safeName}.${format}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "Export failed")
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div class="sheet-editor" tabindex="0" @keydown="onGridKeydown" @paste="onPaste">
    <div v-if="!readonly" class="sheet-toolbar">
      <span class="coord-badge">{{ activeKey }}</span>
      <span class="fx-label">fx</span>
      <input
        v-model="formulaValue"
        class="formula-input"
        :placeholder="t('docs.formulaPlaceholder')"
        @keydown.stop
      />

      <div class="sheet-tools">
        <button class="tool-btn" :class="{ active: activeCell.bold }" type="button" title="Bold" @click="toggleBold">
          <Bold :size="14" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: activeCell.align === 'left' }"
          type="button"
          @click="setAlign('left')"
        >
          <AlignLeft :size="14" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: activeCell.align === 'center' }"
          type="button"
          @click="setAlign('center')"
        >
          <AlignCenter :size="14" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: activeCell.align === 'right' }"
          type="button"
          @click="setAlign('right')"
        >
          <AlignRight :size="14" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: Boolean(activeCell.bg) }"
          type="button"
          :title="t('docs.fill')"
          @click="toggleFill"
        >
          <PaintBucket :size="14" />
        </button>
        <button class="tool-btn" type="button" :title="t('docs.sortCol')" @click="sortByActiveCol">
          <ArrowUpDown :size="14" />
        </button>
        <button class="text-tool" type="button" @click="addRows">+{{ t("docs.row") }}</button>
        <button class="text-tool" type="button" @click="addCols">+{{ t("docs.col") }}</button>

        <input ref="sheetInput" type="file" accept=".xlsx,.xls,.csv" hidden @change="handleImportSheet" />
        <button class="text-tool" type="button" @click="sheetInput?.click()">
          <Upload :size="13" />
          .xlsx
        </button>
        <button class="text-tool" type="button" :disabled="exporting" @click="handleExport('xlsx')">
          <Download :size="13" />
          .xlsx
        </button>
        <button class="text-tool" type="button" :disabled="exporting" @click="handleExport('csv')">
          <Download :size="13" />
          .csv
        </button>
      </div>
    </div>

    <div v-else-if="allowExport" class="readonly-bar">
      <button class="ghost-button small-export" type="button" :disabled="exporting" @click="handleExport('xlsx')">
        <Download :size="14" />
        {{ t("docs.exportExcel") }}
      </button>
    </div>

    <div class="grid-scroll">
      <table class="sheet-table">
        <thead>
          <tr>
            <th class="corner-th" />
            <th
              v-for="c in activeSheet.cols"
              :key="c"
              class="col-th"
              :class="{ active: !readonly && activeCol === c - 1 }"
            >
              {{ colIndexToLetter(c - 1) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in activeSheet.rows" :key="r">
            <th class="row-th" :class="{ active: !readonly && activeRow === r - 1 }">
              {{ r }}
            </th>
            <td
              v-for="c in activeSheet.cols"
              :key="c"
              class="cell-td"
              :class="{ active: !readonly && activeRow === r - 1 && activeCol === c - 1 }"
              :style="getCellStyle(r - 1, c - 1)"
              @click="selectCell(r - 1, c - 1)"
              @dblclick="startEdit()"
            >
              <input
                v-if="editing && activeRow === r - 1 && activeCol === c - 1"
                ref="cellInputRef"
                v-model="editBuffer"
                class="cell-input"
                @blur="commitEdit"
              />
              <span v-else class="cell-text">{{ displayValue(r - 1, c - 1) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="sheet-tabs">
      <button
        v-for="tab in workbook.sheets"
        :key="tab.id"
        class="sheet-tab"
        :class="{ active: tab.id === activeSheet.id }"
        type="button"
        @click="workbook.activeSheetId = tab.id"
        @dblclick="renameSheetTab(tab)"
      >
        <span>{{ tab.name }}</span>
        <X
          v-if="!readonly && workbook.sheets.length > 1"
          :size="12"
          class="tab-close"
          @click.stop="removeSheetTab(tab.id)"
        />
      </button>
      <button v-if="!readonly" class="add-tab" type="button" :title="t('docs.addSheet')" @click="addSheetTab">
        <Plus :size="14" />
      </button>
    </footer>
  </div>
</template>

<style scoped>
.sheet-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}

.sheet-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
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

.coord-badge {
  min-width: 44px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  font-size: 12px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.fx-label {
  font-style: italic;
  font-weight: 700;
  font-size: 12px;
  color: var(--muted);
}

.formula-input {
  flex: 1;
  min-width: 140px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  font-size: 12px;
  outline: none;
}

.formula-input:focus {
  border-color: var(--accent);
}

.sheet-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.tool-btn {
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
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
  padding: 0 7px;
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

.grid-scroll {
  flex: 1;
  overflow: auto;
  background: var(--panel);
}

.sheet-table {
  border-collapse: collapse;
  table-layout: fixed;
  width: max-content;
  min-width: 100%;
  font-size: 13px;
}

.corner-th,
.col-th,
.row-th {
  background: var(--panel-2);
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  border: 1px solid var(--line);
  user-select: none;
}

.corner-th {
  width: 40px;
  position: sticky;
  top: 0;
  left: 0;
  z-index: 3;
}

.col-th {
  width: 104px;
  height: 26px;
  position: sticky;
  top: 0;
  z-index: 2;
}

.row-th {
  width: 40px;
  height: 28px;
  position: sticky;
  left: 0;
  z-index: 1;
}

.col-th.active,
.row-th.active {
  background: var(--surface-strong);
  color: var(--accent);
}

.cell-td {
  width: 104px;
  height: 28px;
  border: 1px solid var(--line);
  padding: 0;
  position: relative;
  cursor: cell;
  vertical-align: middle;
}

.cell-td.active {
  box-shadow: inset 0 0 0 2px var(--accent);
  z-index: 1;
}

.cell-text {
  display: block;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 26px;
}

.cell-input {
  width: 100%;
  height: 100%;
  border: 0;
  outline: none;
  padding: 0 6px;
  background: var(--panel);
  color: var(--text);
  font-size: 13px;
}

.sheet-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  overflow-x: auto;
}

.sheet-tab {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sheet-tab.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--panel);
}

.tab-close:hover {
  color: var(--danger);
}

.add-tab {
  width: 28px;
  height: 28px;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.add-tab:hover {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
