import { parseOtpAuthUri, type ParsedOtpAuth } from "@notepad/core"

export async function decodeQrImageFile(file: File): Promise<{ rawText: string; parsed: ParsedOtpAuth | null }> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement("canvas")
  const maxDim = 1200
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    bitmap.close()
    throw new Error("Canvas context unavailable")
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const { default: jsQR } = await import("jsqr")
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth"
  })

  if (!result?.data) {
    throw new Error("No QR code detected in image")
  }

  return {
    rawText: result.data,
    parsed: parseOtpAuthUri(result.data)
  }
}
