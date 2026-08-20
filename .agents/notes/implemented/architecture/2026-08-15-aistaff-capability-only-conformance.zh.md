# Agent Note：仅能力一致性验收不启用生产读取

[English](2026-08-15-aistaff-capability-only-conformance.md) | 中文

状态：已实现

## 问题

桌面端需要在 Aistaff 发布 `capability_only` 所需的生产产物、设备认证和 Cloud 分发前，验证完整的本地同意用户流程。迁移后的 Rust Supervisor 已有真实的认证进程传输和 Grant 准入，但生产文件读取与目录列举仍返回 `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`。把内存读取视为生产证据，会掩盖仍然缺失的执行策略、身份和恢复 owner。

## 决策

AiDesktop 分离生产组合与一致性验收组合。桌面生产 Profile 不加载 Local Capability。单独命名的 `test_only` Cloud 本地一致性组合包使用生产 Cloud 适配器、Employee Experience、Local Capability Remotes 和产品 UI，并配备来源固定的内存 Supervisor。其结果只证明 Consumer 和投影链。

Local Capability 是 Host 持有的协调器，涵盖权威 Cloud `local_operation`、可信目录选择器、`SupervisorControlPort` 和标准 Material 结果接收端。Renderer 只导入浏览器安全的对象层，并通过仓库唯一的 Typert Remote 组合接收完整且不含路径的替换内容。路径、能力上下文、传输 token、文件系统目标、Cloud cursor 和本地结果内容均不进入 Renderer。

Cloud Approval、Local Consent、Supervisor Grant 与 DSH Tool Approval 是相互独立的决策。Carrier 失败保留原始操作身份和精确重放输入；reconciliation 在允许重放同一请求前读取该操作。Supervisor Receipt 持有结算权：只有 `succeeded` 会改变 active／revoked 资源状态或发布 Material，`failed`、`rejected` 和 `unknown` 只保留脱敏证据及匹配的操作状态。标准 Material owner 在 Employee Experience 刷新可见投影前提交已准入的结果。

## 考虑过的替代方案

未在桌面 Profile 中启用一致性验收 Supervisor，因为它会在没有 Rust 生产策略时执行 fixture 数据。未通过 DSH 文件系统服务路由 Cloud 本地操作，因为这会把路径移入错误进程并绕过 Supervisor Grant。未返回空的或成功的生产响应，因为这会报告生产执行器从未执行的效果。

## 后果

DSH shell 和生产 UI 可以端到端运行，而不会削弱生产边界。一致性验收结果不能证明生产读取支持、持久 Receipt 恢复、设备身份、设备认证或 Cloud 确认。生产 `capability_only` 仍不可用，直到后续任务通过固定产物和正式 Supervisor Provider 启用 Rust read／list，再持久化并 reconcile 已签名 Receipt。当前约定和状态由 [API](../../../../Doc/API.md#3-hostsupervisor)、[架构](../../../../Doc/架构.md#4-客户端执行形态)、[数据](../../../../Doc/数据.md#42-supervisorstatestore) 和 [V2 任务](../../../../Doc/tasks/V2-capability-only-read.md)持有。
