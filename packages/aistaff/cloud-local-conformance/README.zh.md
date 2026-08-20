# Aistaff Cloud 本地一致性测试

[English](README.md) | 中文

专为 `@voyaseek-ai/dsh-aistaff-cloud-conformance` 中显式 `local_read` 场景设计的仅用于测试的 Host 组合。它挂载一个固定的原生目录选择器、内存中运行的 Supervisor 提供方，以及 `LocalCapabilityCoordinator`。结果输出端将有界目录或文本输出，通过同一权威的 Cloud 测试前置数据（fixture）回传：该 fixture 拥有规范化的产物（Material）、Cloud 收据（Cloud Receipt）、已完成活动（Activity）、交互移除记录，以及可回放的 SSE 事件。

原生 fixture 路径对选择器和 Supervisor 保持私有。渲染器（Renderer）的投影（projections）与事件帧（event frames）仅包含资源显示标签、不透明句柄、规范化的产物（Material）标识符，以及不含路径的结果内容。生产环境组合包不得依赖本包。

## 模型体验

无，因为该仅测试 fixture 只发布 Renderer 安全状态，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；该 fixture 不组装或发送模型请求。

## 已知限制与待办事项

- **仅限测试的本地访问** —— 本包使用固定 fixture 路径和内存 Supervisor provider，不得由生产 bundle 挂载。
