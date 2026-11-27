import type { SheetCell, SheetWorkbook } from "@notepad/core"

export function colIndexToLetter(index: number): string {
  let n = index
  let result = ""
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result
    n = Math.floor(n / 26) - 1
  }
  return result
}

export function letterToColIndex(letters: string): number {
  let result = 0
  const upper = letters.toUpperCase()
  for (let i = 0; i < upper.length; i += 1) {
    result = result * 26 + (upper.charCodeAt(i) - 64)
  }
  return result - 1
}

export function cellKey(row: number, col: number): string {
  return `${colIndexToLetter(col)}${row + 1}`
}

export function parseCellKey(key: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(key.trim())
  if (!match || !match[1] || !match[2]) return null
  const col = letterToColIndex(match[1])
  const row = Number(match[2]) - 1
  if (col < 0 || row < 0) return null
  return { row, col }
}

function expandRange(startKey: string, endKey: string): string[] {
  const a = parseCellKey(startKey)
  const b = parseCellKey(endKey)
  if (!a || !b) return []
  const r1 = Math.min(a.row, b.row)
  const r2 = Math.max(a.row, b.row)
  const c1 = Math.min(a.col, b.col)
  const c2 = Math.max(a.col, b.col)
  const keys: string[] = []
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      keys.push(cellKey(r, c))
    }
  }
  return keys
}

function splitTopLevelArgs(input: string): string[] {
  const args: string[] = []
  let depth = 0
  let inQuotes = false
  let current = ""

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if (!inQuotes && ch === "(") {
      depth += 1
      current += ch
    } else if (!inQuotes && ch === ")") {
      depth -= 1
      current += ch
    } else if (!inQuotes && depth === 0 && ch === ",") {
      args.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  if (current.trim() !== "") args.push(current.trim())
  return args
}

// Safe recursive-descent arithmetic parser (no eval / new Function)
function evaluateArithmetic(expr: string): number {
  let pos = 0
  const s = expr.replace(/\s+/g, "")

  function parseExpression(): number {
    let left = parseTerm()
    while (pos < s.length && (s[pos] === "+" || s[pos] === "-")) {
      const op = s[pos++]
      const right = parseTerm()
      left = op === "+" ? left + right : left - right
    }
    return left
  }

  function parseTerm(): number {
    let left = parseFactor()
    while (pos < s.length && (s[pos] === "*" || s[pos] === "/" || s[pos] === "%")) {
      const op = s[pos++]
      const right = parseFactor()
      if (op === "*") left *= right
      else if (op === "/") {
        if (right === 0) throw new Error("#DIV/0!")
        left /= right
      } else {
        if (right === 0) throw new Error("#DIV/0!")
        left %= right
      }
    }
    return left
  }

  function parseFactor(): number {
    if (s[pos] === "+") {
      pos += 1
      return parseFactor()
    }
    if (s[pos] === "-") {
      pos += 1
      return -parseFactor()
    }
    if (s[pos] === "(") {
      pos += 1
      const val = parseExpression()
      if (s[pos] !== ")") throw new Error("#ERR!")
      pos += 1
      return val
    }
    const start = pos
    while (pos < s.length && /[0-9.]/.test(s[pos]!)) {
      pos += 1
    }
    if (start === pos) throw new Error("#VALUE!")
    const num = Number(s.slice(start, pos))
    if (!Number.isFinite(num)) throw new Error("#VALUE!")
    return num
  }

  const result = parseExpression()
  if (pos !== s.length) throw new Error("#ERR!")
  return result
}

function collectArgValues(
  rawArgs: string[],
  cells: Record<string, SheetCell>,
  visited: Set<string>
): string[] {
  const out: string[] = []
  for (const arg of rawArgs) {
    const rangeMatch = /^([A-Za-z]+\d+):([A-Za-z]+\d+)$/.exec(arg)
    if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
      for (const k of expandRange(rangeMatch[1], rangeMatch[2])) {
        out.push(evaluateCell(k, cells, visited))
      }
    } else if (/^".*"$/.test(arg)) {
      out.push(arg.slice(1, -1))
    } else {
      out.push(evaluateExpression(arg, cells, visited))
    }
  }
  return out
}

function collectNumbers(values: string[]): number[] {
  const nums: number[] = []
  for (const v of values) {
    if (v.trim() === "") continue
    const n = Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  return nums
}

function evalCondition(cond: string, cells: Record<string, SheetCell>, visited: Set<string>): boolean {
  const ops = [">=", "<=", "<>", "!=", "=", ">", "<"] as const
  for (const op of ops) {
    const idx = cond.indexOf(op)
    if (idx !== -1) {
      const leftStr = evaluateExpression(cond.slice(0, idx).trim(), cells, visited)
      const rightStr = evaluateExpression(cond.slice(idx + op.length).trim(), cells, visited)
      const ln = Number(leftStr)
      const rn = Number(rightStr)
      const numeric = leftStr !== "" && rightStr !== "" && Number.isFinite(ln) && Number.isFinite(rn)
      const l = numeric ? ln : leftStr
      const r = numeric ? rn : rightStr
      if (op === ">=") return l >= r
      if (op === "<=") return l <= r
      if (op === "<>" || op === "!=") return l !== r
      if (op === "=") return l === r
      if (op === ">") return l > r
      if (op === "<") return l < r
    }
  }
  const v = evaluateExpression(cond, cells, visited)
  return Boolean(v && v !== "0" && v.toLowerCase() !== "false")
}

function evaluateExpression(
  expr: string,
  cells: Record<string, SheetCell>,
  visited: Set<string>
): string {
  const trimmed = expr.trim()
  if (trimmed === "") return ""
  if (/^".*"$/.test(trimmed)) return trimmed.slice(1, -1)

  // Function call: FUNC(args...)
  const fnMatch = /^([A-Za-z]+)\(([\s\S]*)\)$/.exec(trimmed)
  if (fnMatch && fnMatch[1] && fnMatch[2] !== undefined) {
    const fn = fnMatch[1].toUpperCase()
    const rawArgs = splitTopLevelArgs(fnMatch[2])

    if (fn === "IF" && rawArgs.length >= 2) {
      const truthy = evalCondition(rawArgs[0]!, cells, visited)
      const branch = truthy ? rawArgs[1]! : rawArgs[2] ?? '""'
      return evaluateExpression(branch, cells, visited)
    }

    const vals = collectArgValues(rawArgs, cells, visited)
    const nums = collectNumbers(vals)

    if (fn === "SUM") return String(nums.reduce((a, b) => a + b, 0))
    if (fn === "AVERAGE" || fn === "AVG") {
      return nums.length ? String(Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(6))) : "0"
    }
    if (fn === "MIN") return nums.length ? String(Math.min(...nums)) : "0"
    if (fn === "MAX") return nums.length ? String(Math.max(...nums)) : "0"
    if (fn === "COUNT") return String(nums.length)
    if (fn === "COUNTA") return String(vals.filter((v) => v.trim() !== "").length)
    if (fn === "ABS") return nums[0] !== undefined ? String(Math.abs(nums[0])) : "0"
    if (fn === "ROUND") {
      const value = nums[0] ?? 0
      const digits = Math.max(0, Math.min(10, Math.trunc(nums[1] ?? 0)))
      const factor = 10 ** digits
      return String(Math.round(value * factor) / factor)
    }
    if (fn === "CONCAT") return vals.join("")
    throw new Error("#NAME?")
  }

  // Single cell reference
  if (/^[A-Za-z]+\d+$/.test(trimmed)) {
    return evaluateCell(trimmed.toUpperCase(), cells, visited)
  }

  // Replace nested function calls first (innermost without parens)
  let resolved = trimmed
  const innerFnRegex = /([A-Za-z]+)\(([^()]*)\)/
  let guard = 0
  while (innerFnRegex.test(resolved) && guard < 20) {
    guard += 1
    resolved = resolved.replace(innerFnRegex, (full) => evaluateExpression(full, cells, visited))
  }

  // Replace cell references with numeric values for arithmetic
  resolved = resolved.replace(/\b([A-Za-z]+\d+)\b/g, (ref) => {
    const val = evaluateCell(ref.toUpperCase(), cells, visited)
    if (val.trim() === "") return "0"
    const num = Number(val)
    if (!Number.isFinite(num)) throw new Error("#VALUE!")
    return String(num)
  })

  const num = evaluateArithmetic(resolved)
  return Number.isInteger(num) ? String(num) : String(Number(num.toFixed(6)))
}

export function evaluateCell(
  key: string,
  cells: Record<string, SheetCell>,
  visited: Set<string> = new Set()
): string {
  const normalized = key.toUpperCase()
  const cell = cells[normalized]
  if (!cell || !cell.v) return ""
  const raw = cell.v.trim()
  if (!raw.startsWith("=")) return cell.v

  if (visited.has(normalized)) return "#CIRC!"
  const nextVisited = new Set(visited)
  nextVisited.add(normalized)

  try {
    return evaluateExpression(raw.slice(1), cells, nextVisited)
  } catch (err) {
    return err instanceof Error && err.message.startsWith("#") ? err.message : "#ERR!"
  }
}

export function extractSheetExcerpt(workbook: SheetWorkbook): string {
  const first = workbook.sheets[0]
  if (!first) return ""
  const values = Object.values(first.cells)
    .map((c) => c.v.trim())
    .filter((v) => v && !v.startsWith("="))
    .slice(0, 8)
  const preview = values.join(" · ")
  const sheetLabel = `${workbook.sheets.length} Sheet`
  return (preview ? `${sheetLabel} · ${preview}` : sheetLabel).slice(0, 200)
}
