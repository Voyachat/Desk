# 实施任务索引

[English](README.md) | 中文

## 当前目标

Cloud 主干与 `capability_only/read_only` 的仅测试用一致性（test-only conformance）均已达成。Local 链路已全线贯通，涵盖 Supervisor Control、Local Capability、Host↔Renderer 远程通信、Local Consent UI、canonical Material/Receipt 及热重载（reload）；真实的 Rust 控制逻辑、加密持久化回放（encrypted persistent replay）以及 Host 进程 Provider 也已实现。但发布版 sidecar 默认不启用任何能力（capabilities），正式产物（artifact）、设备可信证明（device attestation）、OS-vault 数据密钥（OS-vault data key）与 Cloud 确认响应（Cloud ack）仍缺失，因此生产环境（production）持续处于“拒绝开启”（fail closed）状态。

用户反馈统一归集至 [Bug 台账](../BUGS.md)；统一模型失败提示、任务终态收敛机制、动态插件持久化/TSX/HMR 支持、Workflow 崩溃恢复能力，以及当前会话看板的源码纵向切片均已开发完成，正等待打包前的批量集成验证。Keychain 弹窗、消息复制功能与 Approval Auto-Reject（审批自动拒绝）均已通过真实场景验收。

当前处于集中修复阶段：每次修改仅运行所属包的聚焦测试（focused test）及直接触发失败路径所必需的最小测试集，不重复执行全仓构建（monorepo build）或组合式 Web/Desktop 验收；也不执行 Runtime stage、Forge package/make、DMG 生成或安装覆盖操作。仅当用户在问题全面收敛后明确授权打包时，才集中执行一次全仓构建、关键主流程验证、Runtime/安全门禁检查及 DMG 验收。

## 不可破坏边界

- DSH 实现应优先使用仓库内已登记的本地源码快照；当本机证据不足时，可从 GitHub 获取权威上游版本，但采用前必须验证其可用性、许可证合规性及不可变基线（immutable baseline）；业务项目严禁依赖临时克隆目录。
- 不得修改 `packages/core/agent-loop`；Aistaff 仅可通过插件（plugin）、Slot、Service 和 Bundle 进行能力叠加。
- 默认聊天界面、工作区、设置面板、对话交互与轨迹（transcript）交互，继续由 DSH 原生组件负责。
- Tenant/Industry/Role 源配置仅在服务端完成组合；客户端仅激活已解析且已签名的 Device Bundle。
- 本地 `Employee/Task/Approval/Receipt` Provider 仅保留为 UI 一致性（UI conformance）的测试前置数据（fixture），不属于云端合同范畴，亦不再新增任何业务能力。
- V1 审批状态仅表示“已批准，等待执行”；真实文件操作与本地副作用仍严格后置，不得伪造为任务成功。
- 设计文档仅为实现指引；运行中的代码、测试用例与可观测行为才是当前事实依据；编码过程中若发现与设计文档冲突，须同步修正原文。

## 顺序与状态

1. `V1-contracts.md`：本地 UI 验收所需的数据传输对象（DTO）与投影（projection）已完成；该文档已冻结，作为 fixture 使用。
2. `V1-client-plugin.md`：Client Slot 与组件交互边界已完成；当前 Store/Port 仍为 fixture；正式 object-layer 状态边界将在 Cloud 任务收口处确立。
3. [`V1-remote-mainline.md`](./V1-remote-mainline.md)：已完成；真实 Host↔Client 远程通信、产品级 Bundle 与无密钥（keyless）Web 主流程均已通过验证。
4. [`V1-desktop.md`](./V1-desktop.md)：已完成当前 macOS x86_64 平台的封装与真实模型接入；Electron `42.7.0` 版本的 `.app` 包与 DMG 安装包已在包内 Runtime 及 GUI 进程链上，通过隔离启动、HTTP 通信与进程退出等验收项；Gemini 与 Qwen 模型均经由真实 DSH 路由（route）完成应答；ZIP 格式不再作为发布产物。
5. [`V1-cloud-gateway.md`](./V1-cloud-gateway.md)：客户端一致性（conformance）主干已完成；生产环境启用门槛已冻结；当正式 artifact/transport 缺失时，系统将稳定拒绝加载。
6. 真实 Aistaff 一致性验证：当前存在外部阻塞；需等待服务端发布 Client Gateway artifact、endpoint 及黑盒测试环境后，再使用同一适配器（adapter）与 Web 流程完成验收。
7. [`V2-capability-only-read.md`](./V2-capability-only-read.md)：一致性验证与本地 production 前置层已完成；生产环境外部依赖尚未就绪（production external blocked）；下一阶段仅需接入正式 artifact/attestation/OS-vault data key/Cloud ack，并激活现有 read/list Provider。
8. 分支开发：`managed_runtime`、客户 IPC 通信与升级自动化，按独立纵向切片持续推进。

## 最小验收

仅测试用一致性（test-only conformance）已在保持 DSH 默认页面不变的前提下，完成 Cloud 主干与 Local read consumer 链路，并支持整页刷新后恢复 canonical projection（规范投影）。production profile 不加载 Local conformance 或新增的 process Provider；发布版 sidecar 默认 control capabilities 为空，旧 file service 仍返回 `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`。在下一任务完成正式 artifact、attestation、OS-vault data key 与 Cloud ack 之前，不得宣称 production 环境下的 `capability_only` 已完成。
