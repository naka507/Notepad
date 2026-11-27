import { createPinia } from "pinia"
import { createApp } from "vue"
import "element-plus/theme-chalk/base.css"
import "element-plus/theme-chalk/el-button.css"
import "element-plus/theme-chalk/el-dialog.css"
import "element-plus/theme-chalk/el-input.css"
import "element-plus/theme-chalk/el-message.css"
import "element-plus/theme-chalk/el-message-box.css"
import "element-plus/theme-chalk/el-option.css"
import "element-plus/theme-chalk/el-overlay.css"
import "element-plus/theme-chalk/el-popover.css"
import "element-plus/theme-chalk/el-popper.css"
import "element-plus/theme-chalk/el-radio-button.css"
import "element-plus/theme-chalk/el-radio-group.css"
import "element-plus/theme-chalk/el-select.css"
import "@web/styles/main.css"
import "./styles/desktop.css"
import App from "./App.vue"

const app = createApp(App)
app.use(createPinia())
app.mount("#app")
