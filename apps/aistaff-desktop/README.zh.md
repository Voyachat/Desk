# Voyaseek Desktop

[English](README.md) | 中文

此包使用 Electron 封装 Voyaseek Web 产品。Renderer 不接收 Node 或 IPC bridge。主进程使用 Electron 内置的 Node Runtime 启动随附的 DSH CLI，并传入 loader 所需的 `--expose-internals` 标志；它只接受内容完全匹配的 `127.0.0.1` 就绪行，并负责关闭子进程。

首次创建 profile 时，桌面端选择 `workspace-write` 权限预设，并让 `read-only` 与 `workspace-write` 使用交互式审批；`danger-full-access` 与上游基础 bundle 一致，不显示审批提示。通用 DSH 基础 bundle 保持无人值守的 Full Access 行为。系统注册两个低价路由：当 Electron 报告的操作系统国家码为中国大陆（`CN`）时，默认使用 `dashscope/qwen3.7-flash`；其他地区或无法取得国家码时，默认使用 `google/gemini-3.1-flash-lite`。应用不使用 IP 定位，也不会覆盖用户编辑过的 profile。模型凭据保存在仓库和安装包之外：主进程从 `~/.codex/secrets/gemini.env` 读取 `GEMINI_API_KEY`，从 `~/.codex/secrets/qwen.env` 优先读取 `DASHSCOPE_API_KEY`，并兼容本机的 `QWEN_API_KEY`。系统只接受不超过 64 KiB、仅文件所有者可读的普通文件。显式继承的进程变量优先，凭据值只通过 DSH 子进程环境传递。

Provider 请求使用显式启动代理，或 Electron 为 Gemini 与 DashScope 端点解析到的同一个无凭据 HTTP(S) 系统代理。按域拆分的 PAC 结果、以 `DIRECT` 开头的结果、SOCKS、带身份验证的指令或格式错误的指令都不会被改写为全局 Node 代理。子进程启用 Node 环境代理支持，并同时设置两种 `NO_PROXY` 拼写，以排除 `127.0.0.1` 和 `localhost`。BrowserWindow 还会在导航前独立解析 Runtime URL，并且只在返回的每条指令都是 `DIRECT` 时启动；未加密的 loopback 页面不会通过代理回退。代理凭据、模型凭据和原始值都不会进入 profile patch、命令行、Renderer 或应用日志。

该应用由仓库的 pnpm workspace 安装。其本地 npm lock 记录经过审计、只来自 registry 的 Electron 和 Forge 依赖图；不要使用 npm 安装此包，也不要在 Runtime staging 期间并发执行 workspace 安装。

产品图标遵循[桌面打包规则](../../docs/electron-packaging.md#product-icon)。

打包后的 Runtime 还会携带作为物理可执行文件的 release `aistaff-desktop-supervisor` sidecar。Staging 会验证它是 x86_64 Mach-O、只链接系统动态库、具有可执行权限并且不包含 workspace 路径。当前 `aistaff` profile 不启动生产 control provider，sidecar 也不会获得 Store 数据 key 或 control capability；随包交付未启用的二进制文件不代表已激活生产 `capability_only`。

请从仓库根目录运行 `pnpm --filter @voyaseek-ai/dsh-aistaff-desktop typecheck`、`test` 和 `build`。Release build 必须串行执行：先运行 `pnpm --filter @voyaseek-ai/dsh-aistaff-desktop stage:runtime`，再用 `pnpm install --offline` 恢复 workspace link，最后在 `apps/aistaff-desktop` 中运行 `npm run make`。最后一条 npm 命令只执行既有脚本；不要运行 `npm install` 或 `npm ci`。Runtime staging 使用 pnpm 的 legacy deploy 实现，`make` 只消费生成的物理 `aistaff-desktop-runtime/runtime` 目录，并产出 macOS x86_64 DMG。

打包 GUI smoke 不应等待 Electron 主进程输出就绪行，因为主进程会在内部消费子进程的该行。只有当 DSH 子进程监听 loopback 端口、该 URL 返回 HTTP 200 且 Renderer 子进程存在时，才把应用视为就绪。关闭时，主进程、Renderer、DSH 子进程和 listener 都必须在有界 Runtime 宽限期内终止。
