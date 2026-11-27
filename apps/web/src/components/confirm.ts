import { AlertTriangle } from "@lucide/vue"
import { ElMessageBox } from "element-plus/es/components/message-box/index"
import { h } from "vue"
import { t } from "@/i18n"

type DialogTone = "default" | "danger"

type ConfirmOptions = {
  title: string
  message: string
  confirmText: string
  cancelText?: string
  tone?: DialogTone
}

function dialogContent(options: { title: string; message: string; tone?: DialogTone }) {
  return h("div", { class: "app-confirm-content" }, [
    h("div", { class: "app-confirm-title" }, [
      h(AlertTriangle, {
        class: options.tone === "danger" ? "danger" : "",
        size: 18,
        strokeWidth: 2
      }),
      h("span", options.title)
    ]),
    h("p", { class: "app-confirm-message" }, options.message)
  ])
}

export async function confirmDialog(options: ConfirmOptions) {
  try {
    await ElMessageBox.confirm(dialogContent(options), "", {
      autofocus: false,
      cancelButtonClass: "app-confirm-cancel",
      cancelButtonText: options.cancelText ?? t("common.cancel"),
      closeOnClickModal: true,
      closeOnPressEscape: true,
      confirmButtonClass: options.tone === "danger" ? "app-confirm-danger" : "app-confirm-primary",
      confirmButtonText: options.confirmText,
      customClass: "app-confirm-box",
      distinguishCancelAndClose: true,
      showClose: false
    })
    return true
  } catch {
    return false
  }
}
