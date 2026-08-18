# Electron 桌面打包

[English](electron-packaging.md) | 中文

本参考文档定义如何将 Voyaseek Harness 打包为桌面应用。桌面发行版复用现有 Cordis 组合、Web 客户端插件、会话持久化、工具、worker 和原生辅助程序；Electron 负责应用生命周期、桌面窗口、打包资源发现以及最终的本地 IPC 载体。

## 固定工具链决策

- 桌面应用将 `electron` 精确固定为 `42.7.0`，不使用版本范围。Electron 42.7.0 内置 Node.js 24.18.0，满足仓库的引擎要求 `^22.19.0 || >=24.0.0`（[Electron 发行记录](https://releases.electronjs.org/release/v42.7.0)）。
- Electron Forge 是打包与安装程序工具。它集成 Electron 打包、原生依赖重建、平台 maker、签名和 fuse；除非出现 Forge 无法满足的要求，否则不引入第二套发布编排工具。
- Electron 和 Forge 以版本化依赖方式采用，不复制或 fork 源码。添加依赖时，其许可证和传递依赖声明一并加入 `THIRD_PARTY_NOTICES.md`。
- 第一版打包运行时位于 ASAR 之外。Cordis 包发现、profile 包链接、客户端 bundle、worker 入口、原生 addon 和辅助可执行文件都需要真实文件系统路径。后续改用 ASAR 时，必须证明每个此类路径在所有目标平台均已解包且可执行。

### 产品图标

每次 AI Staff macOS 打包都以 [`apps/aistaff-desktop/assets/app-icon.jpg`](../apps/aistaff-desktop/assets/app-icon.jpg) 作为产品原图，并使用由它生成的 `app-icon.icns` 作为发行图标。Electron Forge 必须把同一份 ICNS 同时传给 `packagerConfig.icon` 和 DMG maker 的 `icon`；构建不得回退到 Electron 默认图标，也不得为 DMG 使用另一份图标。替换产品原图必须经过明确的产品决策，重新生成完整的 16–1024 px ICNS 尺寸集，并同步更新 Forge 配置测试。

## 当前运行时拓扑

Web 前端是由 Host 组装的插件应用，不是独立静态 SPA。`apps/web` 构建外壳，[`@voyaseek-ai/dsh-client-modules`](../packages/client/modules/README.md) 发现每个 `dsh.client` 声明、提供其 `lib/client.js` 并注入 `window.__DSH_BOOT__`。[`@voyaseek-ai/dsh-client-connection`](../packages/client/connection/README.md) 通过 HTTP 承载一元请求，并通过 WebSocket 承载 mux 和 host 事件流。

现有 Web profile 已经组合完整的 Host 运行时。[`prepareProfile()`](../packages/boot/app-boot/src/profile.ts) 将 `web` 解析为 base 与 Web 应用组合包，Web 服务器可以绑定端口 `0`，[`@voyaseek-ai/dsh-web-app`](../packages/bundle/web-app/README.md) 只在 loader 完全停稳后输出 `dsh web: http://127.0.0.1:<port>`。第一版桌面交付使用这条就绪输出，不在 Electron 中重复组装 Host。

```text
Electron main
  -> Electron executable in Node mode
  -> @voyaseek-ai/dsh/lib/bin.js --profile web --port 0
  -> Cordis Host, HTTP/WebSocket API, client bundles, and Web dist
  -> dsh web: http://127.0.0.1:<port>
  -> BrowserWindow.loadURL(exactReadyUrl)
```

直接加载 `apps/web/dist/index.html` 不是有效的第一版交付方式：构建后的 HTML 使用根相对资源路径，Host 提供启动图与插件脚本，并且当前客户端连接需要 HTTP 与 WebSocket 端点。

## 第一版交付：loopback 桌面外壳

Electron 主进程把已部署的 CLI 作为受管子进程启动。它使用带 `ELECTRON_RUN_AS_NODE=1` 的 `process.execPath`，传入 `--profile web --port 0`，仅接受 stdout 中精确的 loopback 就绪行，并在就绪后打开该 URL。用户选择的工作区同时作为子进程 `cwd` 和 `DSH_CWD`；Electron 启动目录绝不作为工作区。

窗口以 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` 和 `webviewTag: false` 启动。导航仅允许精确的就绪 origin，拒绝新窗口，默认拒绝权限请求，renderer 既不能访问 Node 全局对象，也不能访问原始 `ipcRenderer`。

应用退出时终止受管子进程，并等待现有 CLI 信号处理路径 dispose Cordis 树。打包验收必须证明退出后 Web 端口、worker、PTY 和子进程均已消失；如果普通进程信号在 Windows 上无法满足该结果，则需要专用的关闭控制路径。

loopback API 是交付步骤，不是最终桌面信任模型。Host 和 Origin 检查降低浏览器可达性，但不认证本机进程，因此桌面包不会把 loopback 形式描述为经过加固的本地 API。

## 可部署运行时闭包

`apps/cli/package.json` 是应用 manifest，不是桌面部署根目录。桌面实现新增纯生产 manifest `apps/desktop-runtime/package.json`，其直接依赖为 Web profile 所需的每个 workspace peer 提供依赖。[`verify-runtime-closure`](../scripts/verify-runtime-closure.ts) 必须在打包前接受该 manifest。

部署流水线沿用 [`build-exe-for-python-sdk.ts`](../scripts/build-exe-for-python-sdk.ts) 中已验证的暂存模式：运行仓库构建，使用 hoisted linker 且关闭自动 peer 安装来执行生产 `pnpm deploy`，只恢复必需的旧式 hoist 包，解引用 workspace 链接，并拒绝所有剩余符号链接。Electron 运行时是部署后的目录，不是 Python JSON-RPC 可执行文件，也不是仓库根 `node_modules` 树。

Forge 通过 `extraResources` 将结果复制到 `process.resourcesPath/runtime`。运行时包含以下文件类别：

| 类别 | 必需的打包内容 |
|---|---|
| Host 包 | 所选组合使用的已构建 `lib` 文件、包 manifest、组合包 patch 和 agent preset |
| Web 应用 | `apps/web/dist`、每个选中 `dsh.client` 包的 manifest，以及每个选中 `lib/client.js` |
| Worker | code-runtime 和 workflow 的 `worker.cjs` 入口，以及它们动态加载的全部包文件 |
| 原生运行时 | 与平台匹配的 `.node` addon、`node-pty` helper、ripgrep、Landlock launcher、Windows ACL helper 和可执行权限位 |
| 法律元数据 | 项目许可证，以及生成的 Electron、Forge、Node、Chromium、原生包和传递依赖第三方声明 |

每个目标操作系统和架构都要针对 Electron 42.7.0 重建或验证原生模块。源码树测试成功不能替代从打包应用中加载每个 addon 并启动每个 helper。

## 可写状态与外部工具

安装资源不可写。会话、设置、凭据元数据、附件、profile override、storage、skill 和其他运行时状态继续位于 `VOYASEEK_HOME`。除非产品明确选择隔离的 Electron 数据目录，并提供迁移与并发访问规则，否则桌面应用保留现有的 `~/.voyaseek` 默认值。

打包 JavaScript 运行时并不意味着同时提供离线操作系统工具链。Shell 工具可能从宿主 `PATH` 调用 `bash`、`pwsh`、`git`、`python`、编译器或其他命令；打包这些程序是独立的发行与许可证决策。安装第三方 profile 插件还需要 pnpm、网络策略和安装脚本治理，因此第一版桌面交付不承诺插件安装能力。

自修改 preset 不能编辑已签名的安装资源。桌面组合要么禁用源码编辑行为，要么把明确支持的编辑重定向到用户所有的扩展或 preset 目录。

## 目标桌面载体

经过加固的桌面组合移除监听中的 Web 服务器，并用 Electron 所有的本地载体替换浏览器传输。受信任的 `dsh-app://` 协议提供构建后的外壳，allowlist 控制的 `dsh-plugin://` 协议只提供 Host 启动图中存在的客户端 bundle。renderer 绝不通过 `eval` 或 `new Function` 执行 bundle 文本。

窄化的 preload API 提供启动 manifest、一元请求/响应调用，以及 mux 与 host 事件流。主进程验证发送方 frame 和 URL、固定 channel 名、RPC method 与 path、请求 schema 和 body 上限。流传输使用 `MessagePort` 或等价的有界适配器，关闭窗口时取消对应 port 与进行中的请求。

现有 [`AbstractApiClient`](../packages/host/apiproxy/src/fetch/client.ts) 继续作为客户端传输基类：Electron 实现覆盖 fetch 和两种事件流方法，同时复用 Typert 网关与 API handler。Web 启动入口还需要异步 manifest provider 以及现有 bundle loader 替换点。该组合属于桌面专用组合包，而不是修改 Web profile 的 HTTP 行为。

## 实现归属

| 位置 | 职责 |
|---|---|
| `apps/desktop` | Electron main 与 preload 入口、窗口策略、受管运行时生命周期、Forge 配置、图标和 maker |
| `apps/desktop-runtime` | 仅用于暂存已打包 Host 运行时的闭合生产依赖 manifest |
| `scripts/` | 可复用的运行时暂存、符号链接拒绝、产物检查和打包后冒烟启动器 |
| `packages/bundle/desktop` | 当本地协议和 IPC 载体替换 loopback 交付时使用的桌面专用 Cordis 组合 |
| 根脚本 | 显式的桌面构建、package、make、运行时闭包和打包后冒烟入口 |

第一版交付需要前三个位置和根命令。`packages/bundle/desktop` 随 IPC 载体一并引入，不作为 loopback Web profile 周围的脚手架。

## 打包验收

1. 构建 Host 库、Client 库与 Web dist，验证桌面运行时闭包，暂存生产运行时，并从干净 checkout 创建 Forge package。
2. 在仓库之外、没有系统 Node 或 pnpm 的机器上启动打包应用；确认首次运行 profile 初始化和精确的就绪 URL。
3. 创建并重新打开会话，通过无密钥测试提供方发送提示词、流式输出、取消轮次并完成 approval 交互。
4. 从打包资源运行 terminal PTY、code-runtime worker、workflow worker、ripgrep 搜索和原生目录选择器。
5. 退出应用，确认 loopback 端口已释放，且没有遗留受管子进程、worker、PTY 或 helper 进程。
6. 检查产物中是否存在仓库路径、pnpm store 路径、符号链接、缺失的客户端 bundle、缺失的 worker 文件，以及未签名或不可执行的原生 helper。
7. 执行平台原生打包检查：macOS 的代码签名与 notarization、Windows 的安装程序与 ACL 行为，以及 Linux 的沙箱或明确降级行为。
8. 对目标 IPC 载体，额外证明没有 API socket 监听、renderer 不存在 Node 全局对象、CSP 排除 `unsafe-eval`、导航和新窗口快速失败、畸形 IPC 请求被拒绝，并且 reload 或 close 会清理每条流。

## 发行边界

首批支持的目标与架构、签名身份、安装程序格式、更新策略、`VOYASEEK_HOME` 隔离策略、内置外部工具、第三方插件安装和自修改行为都是发布输入，不是 Electron 打包的隐含结果。每个目标都需要独立验证原生运行时与签名；一个平台的打包结果不能证明另一个平台可用。
