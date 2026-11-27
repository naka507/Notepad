<script setup lang="ts">
import { Camera, ImagePlus, Loader2, RefreshCw, X } from "@lucide/vue"
import { onBeforeUnmount, ref, watch } from "vue"
import { currentLocale as locale } from "@/i18n"
import { hapticImpact } from "@/native/bridge"
import { decodeQrImageFile } from "@/utils/qrDecode"

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  scanned: [uri: string]
}>()

const videoRef = ref<HTMLVideoElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const starting = ref(false)
const cameraError = ref("")
const scanning = ref(false)
const decodingFile = ref(false)

let stream: MediaStream | null = null
let rafId: number | null = null
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let jsQRModule: ((data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst" }) => { data: string } | null) | null = null

function stopCamera() {
  scanning.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (stream) {
    for (const track of stream.getTracks()) track.stop()
    stream = null
  }
  if (videoRef.value) {
    videoRef.value.srcObject = null
  }
}

async function startCamera() {
  stopCamera()
  cameraError.value = ""
  starting.value = true
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(locale.value === "zh-CN" ? "当前环境不支持调用摄像头，可从相册选择二维码图片。" : "Camera unavailable here. Pick a QR image instead.")
    }
    if (!jsQRModule) {
      const mod = await import("jsqr")
      jsQRModule = mod.default
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    })
    if (!props.open) {
      stopCamera()
      return
    }
    const video = videoRef.value
    if (video) {
      video.srcObject = stream
      await video.play()
      scanning.value = true
      scheduleScan()
    }
  } catch (err) {
    cameraError.value =
      err instanceof Error
        ? err.message
        : locale.value === "zh-CN"
          ? "无法访问摄像头权限"
          : "Camera permission denied"
  } finally {
    starting.value = false
  }
}

function scheduleScan() {
  let lastCheck = 0
  const tick = (ts: number) => {
    if (!scanning.value || !videoRef.value || !jsQRModule) return
    if (ts - lastCheck >= 160) {
      lastCheck = ts
      const video = videoRef.value
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        if (!canvas) {
          canvas = document.createElement("canvas")
          ctx = canvas.getContext("2d", { willReadFrequently: true })
        }
        if (ctx && canvas) {
          const maxDim = 640
          const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight))
          const w = Math.max(1, Math.round(video.videoWidth * scale))
          const h = Math.max(1, Math.round(video.videoHeight * scale))
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w
            canvas.height = h
          }
          ctx.drawImage(video, 0, 0, w, h)
          const imageData = ctx.getImageData(0, 0, w, h)
          const decoded = jsQRModule(imageData.data, w, h, { inversionAttempts: "attemptBoth" })
          if (decoded?.data && decoded.data.trim().toLowerCase().startsWith("otpauth://")) {
            void hapticImpact("medium")
            const value = decoded.data.trim()
            stopCamera()
            emit("scanned", value)
            return
          }
        }
      }
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

async function onPickImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) return
  decodingFile.value = true
  cameraError.value = ""
  try {
    const { rawText } = await decodeQrImageFile(file)
    if (!rawText || !rawText.trim().toLowerCase().startsWith("otpauth://")) {
      cameraError.value =
        locale.value === "zh-CN"
          ? "未在图片中识别到有效的 otpauth:// 二维码"
          : "No valid otpauth:// QR code found in image"
      return
    }
    void hapticImpact("medium")
    stopCamera()
    emit("scanned", rawText.trim())
  } catch (err) {
    cameraError.value = err instanceof Error ? err.message : "Failed to decode image"
  } finally {
    decodingFile.value = false
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      void startCamera()
    } else {
      stopCamera()
    }
  },
  { immediate: true }
)

onBeforeUnmount(stopCamera)
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="scanner-sheet">
      <header class="scanner-head">
        <button class="scanner-btn" type="button" @click="emit('close')">
          <X :size="20" />
        </button>
        <strong>{{ locale === "zh-CN" ? "扫描 2FA 二维码" : "Scan 2FA QR Code" }}</strong>
        <button class="scanner-btn" type="button" :disabled="decodingFile" @click="fileInputRef?.click()">
          <Loader2 v-if="decodingFile" class="spin" :size="18" />
          <ImagePlus v-else :size="19" />
        </button>
        <input ref="fileInputRef" type="file" accept="image/*" hidden @change="onPickImage" />
      </header>

      <div class="scanner-viewport">
        <video ref="videoRef" class="scanner-video" autoplay muted playsinline />
        <div class="scanner-reticle">
          <span class="corner tl" />
          <span class="corner tr" />
          <span class="corner bl" />
          <span class="corner br" />
          <span v-if="scanning" class="scan-line" />
        </div>

        <div v-if="starting" class="scanner-status">
          <Loader2 class="spin" :size="22" />
          <span>{{ locale === "zh-CN" ? "正在启动相机…" : "Starting camera…" }}</span>
        </div>

        <div v-else-if="cameraError" class="scanner-fallback">
          <Camera :size="28" />
          <p>{{ cameraError }}</p>
          <div class="fallback-actions">
            <button class="scanner-action-ghost" type="button" @click="startCamera">
              <RefreshCw :size="14" />
              {{ locale === "zh-CN" ? "重试相机" : "Retry" }}
            </button>
            <button class="scanner-action-primary" type="button" @click="fileInputRef?.click()">
              <ImagePlus :size="14" />
              {{ locale === "zh-CN" ? "从相册选图" : "Pick Image" }}
            </button>
          </div>
        </div>
      </div>

      <footer class="scanner-foot">
        <p>{{ locale === "zh-CN" ? "将验证器二维码对准取景框，或点击右上角从相册导入" : "Align the 2FA QR code in the frame, or pick an image above." }}</p>
      </footer>
    </div>
  </Teleport>
</template>

<style scoped>
.scanner-sheet {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: #09090b;
  color: #fafafa;
  display: flex;
  flex-direction: column;
}

.scanner-head {
  padding: calc(10px + var(--safe-top)) 14px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(9, 9, 11, 0.85);
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.scanner-head strong {
  font-size: 16px;
}

.scanner-btn {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: #fafafa;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.scanner-viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: #000;
}

.scanner-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-reticle {
  position: relative;
  width: min(250px, 68vw);
  height: min(250px, 68vw);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  border-radius: 14px;
  z-index: 2;
}

.corner {
  position: absolute;
  width: 24px;
  height: 24px;
  border-color: #ffffff;
  border-style: solid;
}

.corner.tl { top: -2px; left: -2px; border-width: 3px 0 0 3px; border-top-left-radius: 14px; }
.corner.tr { top: -2px; right: -2px; border-width: 3px 3px 0 0; border-top-right-radius: 14px; }
.corner.bl { bottom: -2px; left: -2px; border-width: 0 0 3px 3px; border-bottom-left-radius: 14px; }
.corner.br { bottom: -2px; right: -2px; border-width: 0 3px 3px 0; border-bottom-right-radius: 14px; }

.scan-line {
  position: absolute;
  left: 14px;
  right: 14px;
  height: 2px;
  background: #ffffff;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.85);
  animation: scan-sweep 2.1s ease-in-out infinite;
}

@keyframes scan-sweep {
  0%, 100% { top: 14px; opacity: 0.4; }
  50% { top: calc(100% - 16px); opacity: 1; }
}

.scanner-status,
.scanner-fallback {
  position: relative;
  z-index: 5;
  background: rgba(18, 18, 22, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 20px;
  max-width: min(320px, 86vw);
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.scanner-fallback p {
  margin: 0;
  font-size: 13px;
  color: #d4d4d8;
}

.fallback-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.scanner-action-ghost,
.scanner-action-primary {
  height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.scanner-action-ghost {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: #fafafa;
}

.scanner-action-primary {
  background: #fafafa;
  border: 1px solid #fafafa;
  color: #09090b;
}

.scanner-foot {
  padding: 16px 20px calc(18px + var(--safe-bottom));
  text-align: center;
  background: rgba(9, 9, 11, 0.92);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.scanner-foot p {
  margin: 0;
  font-size: 12px;
  color: #a1a1aa;
}
</style>
