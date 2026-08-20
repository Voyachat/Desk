# 实施任务索引

English | [中文](README.zh.md)

## 当前目标

Cloud 与 `capability_only/read_only` 的 test-only conformance 主干均已完成。Local 链路已贯通 Supervisor Control、Local Capability、Host↔Renderer Remote、Local Consent UI、canonical Material/Receipt 与 reload；真实 Rust control、加密持久 replay 和 Host process Provider 也已形成，但发布 sidecar 默认不激活 capabilities，正式 artifact、设备 attestation、OS-vault data key 与 Cloud ack 仍缺失，因此 production 继续 fail closed。

用户使用反馈统一进入 [Bug 台账](../BUGS.md)；统一模型失败提示与任务终态收敛、动态插件持久化/TSX/HMR、Workflow 崩溃恢复与当前会话看板的源码纵向切片已经完成，等待打包前的批量集成验证。Keychain 弹窗、消息复制和 Approval Auto-Reject 已通过真实验收。

当前处于集中修复阶段：每项修改只运行所属包的聚焦测试和直接必要的失败路径，不重复执行全仓构建或组合 Web/Desktop 验收，也不执行 Runtime stage、Forge package/make、DMG 生成或安装覆盖。只有用户在问题统一收敛后明确授权打包，才集中执行一次全仓构建、关键主流程、Runtime/安全门禁和 DMG 验收。

## 不可破坏边界

- DSH 实现优先使用仓内已登记的本地源码快照；本机证据不足时可从 GitHub 获取权威上游，但采用前必须验证可用性、许可证和不可变基线，业务项目不得依赖临时克隆目录。
- 不修改 `packages/core/agent-loop`；Aistaff 只通过插件、Slot、Service 和 Bundle 叠加。
- 默认聊天、工作区、设置、对话和轨迹交互继续由 DSH 原组件拥有。
- Tenant/Industry/Role 源配置只在服务端组合；客户端只激活已解析、已签名的 Device Bundle。
- 本地 `Employee/Task/Approval/Receipt` Provider 只保留为 UI conformance fixture，不是云端合同，也不继续增加业务能力。
- V1 审批只表示“已批准，等待执行”；真实文件与本地副作用仍后置，不能伪造成任务成功。
- 设计文档是实现指引；运行代码、测试和可见行为是当前事实，编码中发现冲突时同步修正原文。

## 顺序与状态

1. `V1-contracts.md`：本地 UI 验收 DTO/投影，已完成；冻结为 Fixture。
2. `V1-client-plugin.md`：Client slot/组件交互边界已完成；当前 Store/Port 仍是 Fixture，正式 object-layer 状态边界在 Cloud 任务收口。
3. [`V1-remote-mainline.md`](./V1-remote-mainline.md)：已完成；真实 Host↔Client Remote、产品 Bundle 与 keyless Web 主流程通过。
4. [`V1-desktop.md`](./V1-desktop.md)：已完成当前 macOS x86_64 封装与真实模型接入；Electron `42.7.0` 的 `.app` 与 DMG 已在包内 Runtime 和 GUI 进程链上通过隔离启动、HTTP 与退出验收，Gemini 与 Qwen 均经真实 DSH route 应答；ZIP 不再作为发布产物。
5. [`V1-cloud-gateway.md`](./V1-cloud-gateway.md)：客户端 conformance 主干已完成；production 启用门槛已冻结，正式 artifact/transport 缺失时稳定拒绝装载。
6. 真实 Aistaff conformance：当前外部阻塞；等待服务端发布 Client Gateway artifact、endpoint 与黑盒环境后，以同一 adapter 和 Web 流程验收。
7. [`V2-capability-only-read.md`](./V2-capability-only-read.md)：conformance 与本地 production 前置层已完成，production external blocked；下一块只接正式 artifact/attestation/key/Cloud ack 并激活现有 read/list Provider。
8. 分支：`managed_runtime`、客户 IPC 和升级自动化，按独立纵向切片推进。

## 最小验收

test-only conformance 已在保持 DSH 默认页面不变的前提下完成 Cloud 主干和 Local read consumer 链路，并在整页刷新后恢复 canonical projection。production profile 不装载 Local conformance 或新的 process Provider；发布 sidecar 默认 control capabilities 为空，旧 file service 仍返回 `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`。直到下一任务关闭正式 artifact、attestation、OS-vault data key 与 Cloud ack 前都不能宣称 production `capability_only` 完成。
