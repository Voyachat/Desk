# Aistaff 产品约定

[English](README.md) | 中文

本包定义了确定性 UI 验收测试前置数据（fixture）所使用的、符合 JSON 格式的员工（employee）、任务（task）、审批（approval）、回执（receipt）、事件（event）、快照（snapshot）、结果（result）以及渲染器到宿主（Renderer-to-Host）等类型。实体 ID 在运行时保持为普通字符串，但通过 TypeScript 类型品牌（brand）加以区分，以防止调用方意外混用。

## 模型交互体验

无。本包不提供任何提示词（prompt）片段、模型消息（model message）或工具 schema（tool schema）。

#### KV Cache 影响

无；没有任何导出值会传递至模型请求。

## 已知限制与待办事项

- **仅限测试前置数据词汇** —— 这些以任务为中心的类型并非 Aistaff Cloud 的约定。生产环境集成通过适配器使用经版本化管理的 Workforce/Engagement/Activity/Material/Interaction 约定产物；请勿在此处添加云服务修订版（cloud revisions）、授权（grants）、游标（cursors）或执行证据（execution evidence）。
