# V1D macOS Electron 封装

状态：已完成当前构建机的 macOS x86_64 封装与真实模型接入。Electron `42.7.0` 的 `.app` 与 DMG 已生成；包内 Runtime、HTTP、GUI 主/子进程退出、资源闭包、无符号链接、notices、Gemini 与 Qwen 路由均已验收。ZIP 不再作为发布产物；签名、公证、自动更新与其他平台仍不在本块范围。

## 交付物

Web V1 通过后的原生 macOS 安装产物：固定 Electron `42.7.0`，内置 Web 产物、DSH Host Runtime 和全部生产依赖，目标机器无需安装 Node、pnpm 或独立 DSH。

## read_first

- [`AGENTS.md`](../../AGENTS.md)
- [实施任务索引](./README.md)
- [构建方案 V1D](../构建方案.md#v1dmacos-electron-封装web-v1-后的独立任务块)
- [Electron 封装边界](../架构.md#71-electron-封装边界)
- [Electron desktop packaging](../../docs/electron-packaging.md)
- [Electron 状态根](../数据.md#31-electron-状态根)

## read_if

- 复用 Host 启动与 profile 组合时，只读 `packages/boot/app-boot`、`apps/cli` 的相邻入口和 [Host↔DSH API](../API.md#4-hostdshdshruntimeport)。
- 部署 Runtime 时，只读 `scripts/build-exe-for-python-sdk.ts` 的 staging 模式和 [`verify-runtime-closure`](../../scripts/verify-runtime-closure.ts)。
- 只有客户试点载体进入实现时才读 [Renderer↔Host 载体](../API.md#28-rendererhost-载体)；首个本机包仍使用受限 Loopback。

## do_not_load

- Electron、Forge 或 DSH 的 GitHub 源码
- Aistaff Cloud、Supervisor、`capability_only`、`managed_runtime` 与文件写入实现
- 自动更新、签名、公证和非当前平台 maker
- `packages/bundle/desktop`；它属于后续 IPC 载体，不为 Loopback 包预建

## owned files

- `apps/aistaff-desktop/**`
- `apps/aistaff-desktop-runtime/**`
- `scripts/aistaff-desktop*`
- 根 manifest、workspace、TypeScript 与构建脚本中只为上述两个应用和固定 Electron/Forge 依赖所需的最小条目

## 最小范围

- Electron Main 使用 `process.execPath` 与 `ELECTRON_RUN_AS_NODE=1` 启动 `process.resourcesPath/runtime` 中的 Locked Web profile，端口固定为 `0`，只接受精确 loopback readiness URL。
- Runtime、Client bundles、workers、native addons 和 helper 使用真实文件路径部署在 ASAR 外；安装资源只读，状态写入明确的 `VOYASEEK_HOME`。
- Main 拥有 Host 子进程树和窗口生命周期；启动失败、窗口关闭、应用退出与升级前准备必须释放 Host、worker、PTY、helper 和端口。
- 首个本机包只验收当前构建机的 macOS 架构，不处理真实客户数据；客户 IPC、跨平台、签名、公证和自动更新不在本块。
- AI 员工 `approve` 在桌面包内仍只表示“已批准，等待执行”，不得因封装成功显示为 `succeeded`。
- 首次 profile 默认使用 `google/gemini-3.6-flash`，同时注册 `dashscope/qwen-plus`；密钥只从仓外 `~/.codex/secrets/*.env` 或显式启动环境注入 DSH 子进程，禁止进入 patch、argv、Renderer、日志和安装包。
- Provider 请求继承显式代理或 Electron 为两个模型域名解析出的同一 HTTP(S) 系统代理；Renderer 导航前另行要求 Runtime URL 的全部代理指令均为 `DIRECT`，否则启动失败。

## 验收

- 从干净工作区完成 build、runtime closure、Forge package/make，并将产物移到仓外启动。
- 包内完成 keyless DSH 会话、流式输出、取消、Approval、重开及 AI 员工工作台主流程；目标环境不调用外部 Node、pnpm 或 DSH。
- 产物检查无仓库路径、pnpm-store 路径、符号链接或缺失 Runtime 文件；平台匹配的 native addon 与 helper 可加载。
- 退出后端口释放且无 Host、worker、PTY 或 helper 残留。当前 macOS 产物不作为其他 OS/架构证据。
- 使用真实 DSH profile 分别选择 `google/gemini-3.6-flash` 与 `dashscope/qwen-plus` 完成最小应答；验收只记录 route/model 与成功标记，不记录密钥或完整模型输出。

## 停止条件/下一块

当前 macOS 架构的仓外安装产物通过上述验收即停止；客户试点前另开 Electron IPC 与发布安全块，`capability_only` 和 `managed_runtime` 继续按构建阶段独立拆分。
