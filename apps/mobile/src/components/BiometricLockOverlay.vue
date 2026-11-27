<script setup lang="ts">
import { Delete, Fingerprint, Lock } from "@lucide/vue"
import { onMounted, ref } from "vue"
import { currentLocale as locale } from "@/i18n"
import { hapticImpact } from "@/native/bridge"
import { useLockStore } from "@/stores/lock"

const props = defineProps<{
  title?: string
}>()

const emit = defineEmits<{
  unlocked: []
}>()

const lock = useLockStore()
const pin = ref("")
const error = ref("")
const shaking = ref(false)

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"]

async function pushDigit(d: string) {
  if (pin.value.length >= 6) return
  void hapticImpact("light")
  error.value = ""
  pin.value += d
  if (pin.value.length >= 4) {
    const ok = await lock.verifyPin(pin.value)
    if (ok) {
      void hapticImpact("medium")
      pin.value = ""
      emit("unlocked")
    } else if (pin.value.length === 6) {
      triggerError()
    }
  }
}

async function submitPin() {
  if (pin.value.length < 4) return
  const ok = await lock.verifyPin(pin.value)
  if (ok) {
    void hapticImpact("medium")
    pin.value = ""
    emit("unlocked")
  } else {
    triggerError()
  }
}

function backspace() {
  void hapticImpact("light")
  pin.value = pin.value.slice(0, -1)
  error.value = ""
}

function triggerError() {
  error.value = locale.value === "zh-CN" ? "密码不正确，请重试" : "Incorrect PIN"
  shaking.value = true
  pin.value = ""
  window.setTimeout(() => {
    shaking.value = false
  }, 360)
}

async function triggerBiometric() {
  const reason = locale.value === "zh-CN" ? "验证身份以解锁 Notepad" : "Verify identity to unlock Notepad"
  const ok = await lock.tryBiometricUnlock(reason)
  if (ok) {
    void hapticImpact("medium")
    emit("unlocked")
  }
}

onMounted(() => {
  if (lock.biometricEnabled) {
    void triggerBiometric()
  }
})
</script>

<template>
  <div class="lock-overlay">
    <div class="lock-inner">
      <div class="lock-icon">
        <Lock :size="24" />
      </div>
      <h2>{{ props.title || (locale === "zh-CN" ? "已锁定" : "Locked") }}</h2>
      <p class="muted">
        {{ locale === "zh-CN" ? "输入 PIN 码或使用生物识别解锁" : "Enter PIN or use biometrics to unlock" }}
      </p>

      <div class="pin-dots" :class="{ shake: shaking }">
        <span v-for="idx in 6" :key="idx" class="pin-dot" :class="{ filled: idx <= pin.length }" />
      </div>
      <p v-if="error" class="lock-error">{{ error }}</p>
      <p v-else class="lock-hint">
        {{ pin.length >= 4 ? (locale === "zh-CN" ? "可继续输入或点击解锁" : "Continue or tap Unlock") : "\u00a0" }}
      </p>

      <div class="keypad">
        <button v-for="d in digits" :key="d" type="button" class="key-btn" @click="pushDigit(d)">
          {{ d }}
        </button>
        <button
          v-if="lock.biometricEnabled"
          type="button"
          class="key-btn key-alt"
          :title="locale === 'zh-CN' ? '生物识别' : 'Biometric'"
          @click="triggerBiometric"
        >
          <Fingerprint :size="22" />
        </button>
        <button v-else type="button" class="key-btn key-alt" :disabled="pin.length < 4" @click="submitPin">
          {{ locale === "zh-CN" ? "解锁" : "OK" }}
        </button>
        <button type="button" class="key-btn" @click="pushDigit('0')">0</button>
        <button type="button" class="key-btn key-alt" @click="backspace">
          <Delete :size="20" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lock-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  background: var(--bg);
  display: grid;
  place-items: center;
  padding: calc(20px + var(--safe-top)) 20px calc(24px + var(--safe-bottom));
}

.lock-inner {
  width: min(300px, 100%);
  display: grid;
  justify-items: center;
  gap: 10px;
  text-align: center;
}

.lock-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--panel);
  border: 1px solid var(--line);
  display: grid;
  place-items: center;
}

.lock-inner h2 {
  margin: 4px 0 0;
  font-size: 20px;
}

.lock-inner p {
  margin: 0;
  font-size: 13px;
}

.pin-dots {
  display: flex;
  gap: 12px;
  margin: 12px 0 2px;
}

.pin-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--muted);
  transition: background 120ms var(--ease-out), border-color 120ms var(--ease-out), transform 120ms var(--ease-out);
}

.pin-dot.filled {
  background: var(--accent);
  border-color: var(--accent);
  transform: scale(1.1);
}

.pin-dots.shake {
  animation: shake 320ms ease;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-8px); }
  75% { transform: translateX(8px); }
}

.lock-error {
  color: var(--danger);
  font-size: 12px;
}

.lock-hint {
  color: var(--muted);
  font-size: 12px;
}

.keypad {
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(3, 74px);
  gap: 14px;
}

.key-btn {
  width: 74px;
  height: 58px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--ink);
  font-size: 22px;
  font-weight: 600;
  display: grid;
  place-items: center;
  cursor: pointer;
  transition: transform 100ms var(--ease-out), background 120ms var(--ease-out);
}

.key-btn:active {
  transform: scale(0.94);
  background: var(--surface-hover);
}

.key-alt {
  font-size: 14px;
  background: var(--panel-2);
}

.key-alt:disabled {
  opacity: 0.45;
}
</style>
