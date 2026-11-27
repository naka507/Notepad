export interface CursorPayload {
  timestamp: number
  id: string
}

export function encodeCursor(payload: CursorPayload): string {
  const json = JSON.stringify(payload)
  return btoa(json)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")
}

export function decodeCursor(cursor: string): CursorPayload {
  const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/")
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
  const parsed = JSON.parse(atob(padded)) as Partial<CursorPayload>

  if (typeof parsed.timestamp !== "number" || typeof parsed.id !== "string") {
    throw new Error("Invalid cursor")
  }

  return {
    timestamp: parsed.timestamp,
    id: parsed.id
  }
}
