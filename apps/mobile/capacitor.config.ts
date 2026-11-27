import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "io.qzz.qqx.notepad",
  appName: "Notepad",
  webDir: "dist",
  server: {
    androidScheme: "https",
    iosScheme: "https"
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "DEFAULT"
    }
  }
}

export default config
