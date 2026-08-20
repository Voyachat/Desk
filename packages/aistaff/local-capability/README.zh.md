# Aistaff 本地能力

[English](README.md) | 中文

本包负责 Renderer 安全的本地资源与授权能力 seam。`LocalCapabilityPort` 作为 `ctx.localCapability` 注册；`LocalCapabilityObjectLayer` 发布深度不可变的完整替换对象。Renderer 的输入仅包含不透明的身份标识、预期的版本号，以及一个稳定的 `OperationId`。

宿主协调器（Host coordinator）会在选择或分发操作前，从注入的权威数据源解析出当前的 `LocalOperationRequestView`。它绝不会接受来自 Renderer 的任何操作、参数、风险、策略、文件系统路径、Supervisor 端点、令牌（token）或能力上下文。原生选择操作（Native selections）直接将其路径传递给 Supervisor 授权注册，并仅发布一个显示名称（display name）及不透明的授权身份标识。

Supervisor 收据是结算的权威依据。仅当收据状态为 `succeeded`（成功）时，其对应的注册、读取或撤销操作才可创建活跃资源、发布结果，或投射已被撤销的资源；而状态为 `failed`（失败）、`rejected`（拒绝）或 `unknown`（未知）的收据则始终作为经净化处理的证据保留，并在原始 `OperationId` 下生成对应失败、拒绝或未知的操作状态。

## 模型交互体验

无。`capability_only` 模式在云端员工运行时中执行；本包不引入任何 DSH 模型消息、工具或会话事件（Session Events）。

## 已知限制

生产环境组合必须注入权威的云端交互解析器、受信任的原生选择器、已准入的设备身份以及生产级 Supervisor Control 提供方。合规性包明确限定仅用于测试，禁止由生产环境组合包挂载。
