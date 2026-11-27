const SAFE_INLINE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm"
])

export class FileTooLargeError extends Error {
  constructor(message = "File size limit exceeded") {
    super(message)
    this.name = "FileTooLargeError"
  }
}

export class ContentLengthMismatchError extends Error {
  constructor(message = "Uploaded stream length did not match declared size") {
    super(message)
    this.name = "ContentLengthMismatchError"
  }
}

export function buildR2Key(userId: string, fileId: string, timestamp = Date.now()): string {
  const date = new Date(timestamp)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `u/${userId}/${year}/${month}/${fileId}`
}

export function isSafeInlinePreviewMime(mimeType: string): boolean {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || ""
  return SAFE_INLINE_MIMES.has(normalized)
}

export function encodeContentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const sanitizedAscii = filename.replace(/[\r\n"]/g, "_").replace(/[^\x20-\x7e]/g, "_") || "download"
  const encodedUtf8 = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${disposition}; filename="${sanitizedAscii}"; filename*=UTF-8''${encodedUtf8}`
}

export function buildFileResponseHeaders(options: {
  filename: string
  mimeType: string
  size: number
  etag?: string | null
  forceDownload: boolean
  isPublicShare: boolean
}): Headers {
  const headers = new Headers()
  const safeInline = !options.forceDownload && isSafeInlinePreviewMime(options.mimeType)
  const disposition: "inline" | "attachment" = safeInline ? "inline" : "attachment"

  headers.set("Content-Type", options.mimeType || "application/octet-stream")
  headers.set("Content-Disposition", encodeContentDisposition(options.filename, disposition))
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Accept-Ranges", "bytes")
  headers.set("Cache-Control", options.isPublicShare ? "no-store" : "private, no-store")

  if (!safeInline) {
    headers.set("Content-Security-Policy", "sandbox")
  }
  if (options.isPublicShare) {
    headers.set("X-Robots-Tag", "noindex, nofollow")
  }
  if (options.etag) {
    headers.set("ETag", options.etag)
  }

  return headers
}

/**
 * Wraps a ReadableStream to count exact bytes streamed and abort if maxBytes is exceeded.
 * Keeps Worker memory usage constant and prevents forged Content-Length bypasses.
 */
export function createByteLimitStream(maxBytes: number | null): {
  transform: TransformStream<Uint8Array, Uint8Array>
  getByteLength: () => number
} {
  let totalBytes = 0
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      totalBytes += chunk.byteLength
      if (maxBytes !== null && totalBytes > maxBytes) {
        controller.error(new FileTooLargeError())
        return
      }
      controller.enqueue(chunk)
    }
  })

  return {
    transform,
    getByteLength: () => totalBytes
  }
}

/**
 * Streams a ReadableStream through a hard byte-limit guard into Cloudflare's
 * FixedLengthStream so R2Bucket.put / uploadPart receives a known-length stream
 * with constant Worker memory usage and zero unhandled rejections.
 */
export async function streamToR2WithLimit<T>(options: {
  source: ReadableStream<Uint8Array>
  expectedBytes: number | null
  maxBytes: number
  consume: (body: ReadableStream<Uint8Array> | Uint8Array) => Promise<T>
}): Promise<{ result: T; bytes: number }> {
  const { source, expectedBytes, maxBytes, consume } = options

  if (expectedBytes !== null && expectedBytes > maxBytes) {
    throw new FileTooLargeError()
  }

  if (expectedBytes !== null && expectedBytes > 0 && typeof FixedLengthStream !== "undefined") {
    const fixed = new FixedLengthStream(expectedBytes)
    const { transform, getByteLength } = createByteLimitStream(maxBytes)

    const pipePromise = source.pipeThrough(transform).pipeTo(fixed.writable)
    const consumePromise = consume(fixed.readable)

    const [pipeOutcome, consumeOutcome] = await Promise.allSettled([pipePromise, consumePromise])

    if (pipeOutcome.status === "rejected") {
      if (pipeOutcome.reason instanceof FileTooLargeError) {
        throw pipeOutcome.reason
      }
      if (getByteLength() !== expectedBytes) {
        throw new ContentLengthMismatchError()
      }
      if (consumeOutcome.status === "rejected") {
        throw consumeOutcome.reason
      }
      throw pipeOutcome.reason
    }

    if (consumeOutcome.status === "rejected") {
      throw consumeOutcome.reason
    }

    return { result: consumeOutcome.value, bytes: getByteLength() }
  }

  // Fallback when Content-Length is absent: bounded chunk collection up to maxBytes
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new FileTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  const result = await consume(merged)
  return { result, bytes: total }
}

export function parseRangeHeader(
  rangeHeader: string | null,
  totalSize: number
): { offset: number; length: number; end: number } | null {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=") || totalSize <= 0) return null
  const spec = rangeHeader.slice("bytes=".length).split(",")[0]?.trim()
  if (!spec) return null

  const [startRaw, endRaw] = spec.split("-")
  if (startRaw === undefined || endRaw === undefined) return null

  let start: number
  let end: number

  if (startRaw === "") {
    const suffixLength = Number(endRaw)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(totalSize - suffixLength, 0)
    end = totalSize - 1
  } else {
    start = Number(startRaw)
    end = endRaw === "" ? totalSize - 1 : Math.min(Number(endRaw), totalSize - 1)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= totalSize) {
      return null
    }
  }

  return {
    offset: start,
    length: end - start + 1,
    end
  }
}
