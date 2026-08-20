# Agent Note：桌面启动在 Host 就绪前即可交互

状态：已实现

[English](2026-08-20-desktop-interactive-cold-start.md) | 中文

## 问题

打包后的桌面应用原先会依次等待 profile 准备、两次系统 PAC 查找、受管运行时 spawn、完整 Cordis Loader 停稳、loopback 代理检查与 Web 导航，之后才创建窗口。任何冷文件读取、Gatekeeper 检查、PAC 延迟或 Host 插件启动都会表现为应用没有打开。就绪超时为 30 秒，打包运行时包含超过 26,000 个文件；在此期间，用户既不能输入任务，也不能选择模式。

单独增加一个“启动”标签无法纠正行为。Cordis Loader 没有通用产品阶段，`inject` 在模块 import 后才等待，客户端 `immediately` 只改变预取顺序，而 Web kernel 仍在 settled UI 前创建全部 row，`openAt` 也只属于 SQLite query provider。因此 required、deferred 与 excluded 必须对应可观察的执行与产物规则。

## 决策

`app.whenReady()` 后，Electron 立即创建沙箱窗口并加载 ASAR 所有的本地输入壳。输入壳接受有上限的纯文本草稿，以及发行版提供的 `standard` 或 `code` Agent Preset。只有本地页面显示后，profile 准备、凭据、具有上限的系统代理发现与完整受管 Host 才开始。Host 或导航失败会恢复输入壳并显示重试入口，不丢弃进程内意图。

Preload 只暴露固定的启动 channel。Main 验证所属窗口、顶层 sender frame、精确本地文档或受管 loopback origin、preset，以及 32,000 code unit 的草稿上限。Web 产品等待真实的当前空白 Session，应用并记录 preset，将草稿写入但不发送，并且只在这些步骤成功后确认意图。它不创建占位 Session，也不自动重试结果未知的传输写入。

桌面启动策略当前分为三类。`required` 包含本地输入壳与生成后的 Electron main/preload JavaScript；它们必须保持本地加载，并位于 96 KiB 逻辑字节预算内。`deferred` 包含完整的已部署 Host 运行时，在输入壳显示后启动。`excluded` 包含 macOS x86_64 以外的 `node-pty` prebuild；暂存会物理删除它们，验证会拒绝其存在。普通桌面编译验证 required 闭包。Package 与 make 还会验证生成后的运行时、470 MiB 与 27,000 文件上限、目标 prebuild 和许可证、worker 与客户端产物，以及非目标 prebuild 缺席。

用户可见服务等级从应用启动请求开始计时，直到启动 textarea 可见、获得焦点且可写；在完成签名与 notarization 的发行目标硬件上至少执行 20 次冷启动，要求 `P95 <= 3,000 ms`。完整 Host 就绪时间单独测量。未签名开发应用不能作为发行冷启动证据，因为 macOS 信任评估行为不同。

## 影响

- Host 缓慢或失败不再阻止任务草稿与 Agent Preset 选择。
- 启动输入只存在于当前 Electron 进程内，绝不自动发送；应用终止会丢弃未确认输入。
- 当前策略把 Host 作为一个整体延迟，不声称各个 Host 或客户端插件已经惰性加载。
- 本地关键闭包超过预算、引用远程资源或不再符合策略时，构建会失败。陈旧运行时仍包含 excluded 原生目标或超过产物预算时，打包会失败。
- 删除非目标 `node-pty` prebuild 后，旧运行时可减少约 57.8 MiB。进一步删除包之前，必须证明包含的 entry 或静态 import 不再需要它。
- 签名与 notarization 仍是强制发行输入。本地输入壳从首次交互路径中移除了 Host，但无法绕过 Electron JavaScript 启动前由 macOS 执行的工作。

## 考虑过的替代方案

继续等现有 `dsh web:` 就绪行后再创建窗口会让所有 Host 与平台延迟暴露给用户，因此被否决。直接加载 `apps/web/dist/index.html` 也被否决，因为 Host 会注入启动图、提供客户端 bundle，并持有 HTTP 与 WebSocket API。自动发送保留草稿被否决，因为当前 RPC 没有持久的客户端意图幂等键。

通用的 vendored Loader `phase` 字段暂不引入。除非同时修改 entry 创建、include 组合、HMR、writeback，以及 Host 与浏览器两侧的 readiness，否则当前 Loader 会忽略这层产品含义。后续细粒度实现可以复用零 import 的 `disabled` entry，并在关键就绪后通过内存 `loader.create()` 装配；浏览器 kernel 也可以先创建 required row，再创建 deferred row。在该 controller 出现前，策略如实将完整 Host 视为 deferred。
