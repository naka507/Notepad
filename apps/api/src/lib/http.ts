import type { Context } from "hono"
import { z } from "zod"
import type { AppEnv } from "./auth"

export async function parseJson<S extends z.ZodTypeAny>(
  c: Context<AppEnv>,
  schema: S
): Promise<z.output<S>> {
  const body = (await c.req.json()) as unknown
  return schema.parse(body)
}

export function zodErrorResponse(c: Context<AppEnv>, error: unknown) {
  if (error instanceof z.ZodError) {
    return c.json({ error: "Invalid request", issues: error.issues }, 400)
  }
  throw error
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
