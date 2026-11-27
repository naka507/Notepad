<div align="center">
  <img src="./assets/icon.svg" alt="Notepad 图标" width="76" height="76" />
  <h1>Notepad</h1>
  <p>
    <strong>基于 Cloudflare Free Tier 构建的极简多端云笔记、在线 Word/Excel 文档、小文件保险箱与 2FA 动态码平台。</strong>
  </p>
  <p>
    <a href="./README.md">English</a> · <strong>简体中文</strong> · <a href="./docs/ARCHITECTURE.md">架构设计文档</a>
  </p>
  <p>
    <a href="https://note.qqx.qzz.io">在线访问</a> ·
    <a href="https://github.com/naka507/Notepad/releases">安装包下载（Win / macOS / Linux / Android）</a>
  </p>
</div>

---

## 核心特性

- **五大核心模块与独立分类体系**（每个模块均自带不可删除的系统「默认」分类）：
  - **笔记**：Markdown 编辑与防 XSS 安全预览、置顶、归档与 30 天回收站。
  - **文档（Word）**：基于 TipTap 的富文本编辑器，支持纯前端 `.docx` 导入与导出；正文 JSON 存 R2，不消耗 D1 数据库配额。
  - **表格（Excel）**：多工作表电子表格，内置常用公式引擎（`SUM`、`AVERAGE`、`MIN`、`MAX`、`COUNT`、`IF`、`ROUND`、`ABS`），支持 `.xlsx` / `.csv` 导入与导出。
  - **文件**：`≤ 5 MiB` 单次流式直传与 `> 5 MiB` 自适应分片上传；支持图片 / PDF / Word / Excel 在线预览；对脚本类文件强制安全下载防 XSS。
  - **动态码（2FA / TOTP）**：服务端 AES-256-GCM 加密存储，支持 30 秒倒计时与一键复制、移动端原生相机扫码（`otpauth://`）、本地二维码图片解析、`otpauth://` 链接批量导入与手动录入。
- **风格统一、按端重写的原生体验**：
  - 全端共享极简黑白灰瑞士网格设计令牌与浅色/暗黑模式，并针对不同设备形态独立重写布局：
    - **Web 端（`apps/web`）**：居中分栏工作台，通过 Cloudflare Pages + Service Binding 零冷启动直连 API。
    - **桌面端（`apps/desktop`，Electron）**：无边框自定义标题栏 + 60px 左侧图标轨（`Ctrl+1..7`）+ 可调宽三栏布局 + `Ctrl+K` 全局命令面板 + 系统托盘 + 系统密钥链（`safeStorage`）+ 本地离线缓存 + `notepad://` 深链 OAuth 登录。
    - **移动端（`apps/mobile`，Capacitor）**：单栈导航 + 底部 5 Tab Bar、移动端专属卡片式大字 `动态码`（触感复制 + 相机扫码）、文档/表格融合列表（蓝/绿/暗黑浅蓝区分图标 + 底部新建菜单）、生物识别 / PIN 隐私锁，且移动端设置精简统一（管理员与会员体验一致）。
- **细粒度 RBAC 权限与匿名分享**：
  - 首位注册或 GitHub 登录的用户自动成为 `admin`（管理员），后续用户默认 `pending`（待授权）。
  - 4 个角色（`pending` / `user` / `member` / `admin`），支持单文件大小、文件总数配额与**降级即时锁定**（保留全部历史数据，超限文件立即锁定、恢复角色后自动解锁）。
  - 会员与管理员支持生成高熵限时匿名分享链接（`/s/:code`），支持可选访问密码、最大访问次数与一键撤销。
- **严格运行在 Cloudflare 免费额度内**：
  - Pages + Workers + D1 + R2（含 10 GB 容量预警与硬熔断护栏）+ 单 Key KV + 每小时定时清理 Worker（`apps/cleanup`）。

## 仓库目录结构

```text
Notepad/
├── apps/
│   ├── web/         # Web 前端（Vue 3 + Vite + Pinia + Element Plus，部署于 Cloudflare Pages）
│   ├── desktop/     # Electron 35 桌面端（Windows / macOS / Linux）
│   ├── mobile/      # Capacitor 7 移动端（Android / iOS）
│   ├── api/         # Cloudflare Workers API（Hono + Zod + D1 + R2 + KV）
│   └── cleanup/     # 小时级 Cron 清理 Worker（过期会话、未完成分片、R2 物理回收与过期回收站）
├── packages/
│   └── core/        # 共享层（RBAC 权限、配额常量、Zod 校验、TOTP 算法、同步与 API 类型）
├── assets/          # 1024×1024 跨平台主应用图标（icon.png / icon.svg）
├── docs/            # 完整系统架构规范与 ADR 决策记录（docs/ARCHITECTURE.md）
└── .github/
    └── workflows/   # GitHub Actions CI 校验与全平台自动发版流水线
```

## 本地开发指南

### 环境要求

- Node.js `>= 20`（推荐 `22`）
- 如需本地编译 Android APK：JDK `17` 或 `21` + Android SDK 35

### 1. 启动后端 API 与 Web 前端

```sh
npm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run db:migrate:local

# 终端 1：启动本地 Workers API（http://127.0.0.1:8787）
npm run dev:api

# 终端 2：启动本地 Web 前端
npm run dev:web
```

- 首次注册或使用 GitHub 登录的账号将自动晋升为 `admin` 管理员。
- 后续注册用户默认为 `pending`，需由管理员在「用户」界面授权后使用。

### 2. 启动与打包 Electron 桌面端

```sh
# 首次安装若 npm 拦截了 Electron 的 postinstall 脚本，先手动下载一次运行时：
node node_modules/electron/install.js

# 本地联调（自动启动渲染进程并打开 Electron 窗口）
npm run dev:desktop

# 构建与打包当前平台安装包（Windows NSIS/便携版、macOS DMG、Linux AppImage）
npm run build:desktop
npm run package:desktop
```

### 3. 启动与打包 Capacitor 移动端

```sh
# 浏览器手机视口联调（http://127.0.0.1:5181）
npm run dev:mobile

# 构建移动端资源并同步至 Capacitor 原生工程
npm run build:mobile
npm run cap:sync

# 在 Android Studio / Xcode 中打开原生工程
npm run cap:open:android -w @notepad/mobile
npm run cap:open:ios -w @notepad/mobile
```

本地编译 Android 正式签名 APK 时，在 `apps/mobile/android/` 下放置已忽略的 `keystore.properties`（或配置 `ANDROID_KEYSTORE_*` 环境变量），随后执行：

```sh
cd apps/mobile/android
./gradlew assembleRelease
```

Windows 下也可直接运行 `apps/mobile/scripts/launch-android-emulator.bat` 一键启动本地模拟器、配置 `8787` 端口转发并安装 Debug APK。

## Cloudflare 免费额度部署

1. 创建 D1、R2 与 KV 资源：
   ```sh
   npm run cf:d1:create
   npm run cf:r2:create
   npm run cf:kv:create
   ```
2. 将生成的 `database_id`、KV `id` 与站点域名 `APP_URL` 填入 `apps/api/wrangler.toml` 和 `apps/cleanup/wrangler.toml`。
3. 写入生产环境密钥：
   ```sh
   npm run secret:token:signing
   npm run secret:totp:key
   # 可选：启用 GitHub OAuth 登录与绑定
   npm run secret:github:id
   npm run secret:github:secret
   ```
4. 校验配置、执行远端建表迁移并部署全栈：
   ```sh
   npm run typecheck
   npm run build
   npm run validate:deploy-config
   npm run db:migrate:remote
   npm run deploy:workers
   npm run deploy:web
   ```

> **GitHub OAuth App 回调地址（Callback URL）**：`https://<你的域名>/api/auth/github/callback`

## GitHub Actions 自动化 CI 与发版

- **持续集成（`.github/workflows/ci.yml`）**：每次推送或提交 PR 至 `main`，自动执行部署配置校验、`typecheck` 与全量 `build`。
- **跨平台自动发版（`.github/workflows/release.yml`）**：推送 `v*` 标签（例如 `git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`）或在 Actions 页面手动触发后，并行构建并自动发布至 GitHub Releases：
  - Windows 安装版与绿色便携版（`.exe`）
  - macOS 安装镜像（`.dmg`）
  - Linux 通用包（`.AppImage`）
  - Android 安装包（`.apk`；若在仓库 Secrets 中配置了 `ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 则自动产出正式签名版 `release.apk`，否则自动回退为 `debug.apk`）

## 相关文档

- [English README (README.md)](./README.md)
- [完整架构设计规范与 ADR（docs/ARCHITECTURE.md）](./docs/ARCHITECTURE.md)
