# Aistaff Cloud 客户端

[English](README.md) | 中文

面向宿主环境专用的客户端网关适配器，用于生产环境下的 `EmployeeExperiencePort`。该适配器仅协商一个带版本号的约定选择，构建一个与快照绑定的“员工体验/参与度”基线，仅发布完整且 Renderer 安全的替换内容，并从一个不透明游标恢复至少一次（at-least-once）的 SSE 流。

本包不包含任何生产环境用的 JSON Schema、服务 URL、凭证、令牌或一致性回退机制。生产环境组装时，必须注入一个不可变的 Aistaff 约定产物编解码器及经过身份认证的传输层。传输层负责 URL 解析与身份认证；产物编解码器则负责请求编码、响应校验、事件解码、语义投影组合以及操作结果解码。

变更操作将请求体中的 `operation_id` 与 `Idempotency-Key` 绑定。若发生调度超时或返回 `UNKNOWN_OUTCOME`，系统将通过原始操作进行协调；该适配器绝不会生成新的操作 ID。快照、事件流、约定选择、事件信封及游标等值均保留在宿主提供方内部，永远不会进入 `EmployeeExperienceSnapshot`。

## 模型体验

无，因为该 Host 适配器只发布 Renderer 安全的业务投影，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与待办事项

- **生产产物尚不可用** —— 当前没有已发布的 Aistaff Client Gateway 产物或 provider 一致性环境。测试使用包内 codec 与 carrier；生产启动必须提供固定产物、完整性元数据、transport、协议 offer、超时和初始快照。
