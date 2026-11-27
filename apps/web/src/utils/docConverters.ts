import type { SheetCell, SheetTab, SheetWorkbook } from "@notepad/core"
import DOMPurify from "dompurify"
import { cellKey, evaluateCell } from "./sheetFormula"

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function extractDocExcerpt(docJson: Record<string, unknown>): string {
  const chunks: string[] = []
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return
    const rec = node as Record<string, unknown>
    if (typeof rec.text === "string") {
      chunks.push(rec.text)
    }
    if (Array.isArray(rec.content)) {
      for (const child of rec.content) {
        if (chunks.join(" ").length > 220) break
        walk(child)
      }
    }
  }
  walk(docJson)
  return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 200)
}

export async function importDocxToHtml(input: File | ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth")
  const arrayBuffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return DOMPurify.sanitize(result.value || "<p></p>")
}

interface TipTapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type?: string }>
  content?: TipTapNode[]
}

export async function exportTiptapToDocx(
  title: string,
  docJson: Record<string, unknown>
): Promise<Blob> {
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
  } = await import("docx")

  function alignmentFromAttr(value: unknown) {
    if (value === "center") return AlignmentType.CENTER
    if (value === "right") return AlignmentType.RIGHT
    if (value === "justify") return AlignmentType.JUSTIFIED
    return AlignmentType.LEFT
  }

  function runsFromInline(nodes: TipTapNode[] = []) {
    const runs: InstanceType<typeof TextRun>[] = []
    for (const node of nodes) {
      if (node.type === "hardBreak") {
        runs.push(new TextRun({ break: 1 }))
        continue
      }
      if (node.type === "text" && typeof node.text === "string") {
        const marks = new Set((node.marks ?? []).map((m) => m.type))
        runs.push(
          new TextRun({
            text: node.text,
            bold: marks.has("bold"),
            italics: marks.has("italic"),
            strike: marks.has("strike"),
            ...(marks.has("underline") ? { underline: {} } : {}),
            ...(marks.has("highlight") ? { highlight: "yellow" } : {}),
            ...(marks.has("code") ? { font: "Consolas" } : {})
          })
        )
      }
    }
    return runs.length ? runs : [new TextRun("")]
  }

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = []

  function processBlock(node: TipTapNode, listPrefix?: string) {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level ?? 1)
      const heading =
        level === 1
          ? HeadingLevel.HEADING_1
          : level === 2
            ? HeadingLevel.HEADING_2
            : HeadingLevel.HEADING_3
      children.push(
        new Paragraph({
          heading,
          alignment: alignmentFromAttr(node.attrs?.textAlign),
          children: runsFromInline(node.content)
        })
      )
      return
    }

    if (node.type === "paragraph") {
      const prefixRuns = listPrefix ? [new TextRun({ text: listPrefix })] : []
      children.push(
        new Paragraph({
          alignment: alignmentFromAttr(node.attrs?.textAlign),
          children: [...prefixRuns, ...runsFromInline(node.content)]
        })
      )
      return
    }

    if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
      const items = node.content ?? []
      items.forEach((item, idx) => {
        const checked = item.attrs?.checked === true
        const prefix =
          node.type === "orderedList"
            ? `${idx + 1}. `
            : node.type === "taskList"
              ? checked
                ? "[x] "
                : "[ ] "
              : "• "
        for (const inner of item.content ?? []) {
          processBlock(inner, prefix)
        }
      })
      return
    }

    if (node.type === "blockquote") {
      for (const inner of node.content ?? []) {
        processBlock(inner, "│ ")
      }
      return
    }

    if (node.type === "codeBlock") {
      const codeText = (node.content ?? []).map((n) => n.text ?? "").join("")
      for (const line of codeText.split("\n")) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: line, font: "Consolas" })]
          })
        )
      }
      return
    }

    if (node.type === "table") {
      const rows = (node.content ?? [])
        .filter((r) => r.type === "tableRow")
        .map((r) => {
          const cells = (r.content ?? []).map((cell) => {
            const cellParagraphs = (cell.content ?? []).map(
              (p) =>
                new Paragraph({
                  children: runsFromInline(p.content)
                })
            )
            return new TableCell({
              children: cellParagraphs.length ? cellParagraphs : [new Paragraph("")]
            })
          })
          return new TableRow({ children: cells })
        })
      if (rows.length) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          })
        )
      }
    }
  }

  const root = docJson as TipTapNode
  for (const node of root.content ?? []) {
    processBlock(node)
  }

  const doc = new Document({
    title: title || "Document",
    sections: [{ children: children.length ? children : [new Paragraph("")] }]
  })

  return Packer.toBlob(doc)
}

export async function importSpreadsheetFile(input: File | ArrayBuffer): Promise<SheetWorkbook> {
  const XLSX = await import("xlsx")
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array", cellFormula: true })

  const sheets: SheetTab[] = wb.SheetNames.map((name, idx) => {
    const ws = wb.Sheets[name]
    const cells: Record<string, SheetCell> = {}
    let maxRow = 29
    let maxCol = 11

    if (ws && ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"])
      maxRow = Math.min(200, Math.max(29, range.e.r + 5))
      maxCol = Math.min(36, Math.max(11, range.e.c + 3))

      for (let r = range.s.r; r <= Math.min(range.e.r, maxRow); r += 1) {
        for (let c = range.s.c; c <= Math.min(range.e.c, maxCol); c += 1) {
          const addr = XLSX.utils.encode_cell({ r, c })
          const raw = ws[addr]
          if (!raw) continue
          const value = raw.f ? `=${raw.f}` : raw.v !== undefined && raw.v !== null ? String(raw.v) : ""
          if (value !== "") {
            cells[cellKey(r, c)] = { v: value }
          }
        }
      }
    }

    return {
      id: `sheet_${idx + 1}`,
      name,
      rows: maxRow + 1,
      cols: maxCol + 1,
      colWidths: {},
      cells
    }
  })

  if (!sheets.length) {
    sheets.push({
      id: "sheet_1",
      name: "Sheet1",
      rows: 30,
      cols: 12,
      colWidths: {},
      cells: {}
    })
  }

  return {
    activeSheetId: sheets[0]!.id,
    sheets
  }
}

export async function exportWorkbookToFile(
  workbook: SheetWorkbook,
  format: "xlsx" | "csv"
): Promise<Blob> {
  const XLSX = await import("xlsx")
  const wb = XLSX.utils.book_new()

  for (const tab of workbook.sheets) {
    const aoa: Array<Array<string | number>> = []
    let usedMaxRow = 0
    let usedMaxCol = 0

    for (const [k, cell] of Object.entries(tab.cells)) {
      if (!cell.v) continue
      const decoded = XLSX.utils.decode_cell(k)
      usedMaxRow = Math.max(usedMaxRow, decoded.r)
      usedMaxCol = Math.max(usedMaxCol, decoded.c)
    }

    for (let r = 0; r <= usedMaxRow; r += 1) {
      const rowArr: Array<string | number> = []
      for (let c = 0; c <= usedMaxCol; c += 1) {
        const key = cellKey(r, c)
        const evaluated = evaluateCell(key, tab.cells)
        const num = Number(evaluated)
        rowArr.push(evaluated !== "" && Number.isFinite(num) ? num : evaluated)
      }
      aoa.push(rowArr)
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa)

    // Preserve formulas in xlsx export
    if (format === "xlsx") {
      for (const [key, cell] of Object.entries(tab.cells)) {
        if (cell.v.trim().startsWith("=")) {
          const evaluated = evaluateCell(key, tab.cells)
          const num = Number(evaluated)
          ws[key] = {
            t: evaluated !== "" && Number.isFinite(num) ? "n" : "s",
            v: evaluated !== "" && Number.isFinite(num) ? num : evaluated,
            f: cell.v.trim().slice(1)
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, tab.name.slice(0, 31) || "Sheet1")
  }

  if (format === "csv") {
    const activeTab = workbook.sheets.find((s) => s.id === workbook.activeSheetId) ?? workbook.sheets[0]
    const ws = wb.Sheets[activeTab?.name.slice(0, 31) || "Sheet1"]!
    const csv = XLSX.utils.sheet_to_csv(ws)
    return new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" })
  }

  const arrayBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  })
}
