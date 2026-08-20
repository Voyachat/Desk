# Aistaff 本地能力一致性验收

[English](README.md) | 中文

本包是明确标记为 `test_only` 的完整 Host 组合。它提供固定且权威的 `local_operation`、可信的原生目录选择 fixture、Supervisor Control 内存测试 Provider、标准 Material 接收端和真实 `LocalCapabilityCoordinator`。

fixture 的绝对路径只保留在 selector 的私有 Host 状态和特权 Supervisor 注册调用中。对 Renderer 安全的快照与操作结果只暴露不透明 grant、consent、Receipt、revision 和 Material 标识符。

生产组合包不得依赖或挂载本包。

## 模型体验

无，因为该仅测试本地能力 fixture 不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；该 fixture 不组装或发送模型请求。

## 已知限制与待办事项

- **仅限测试的本地访问** —— 本包使用固定 selector 和内存 Supervisor provider，不得由生产 bundle 挂载。
