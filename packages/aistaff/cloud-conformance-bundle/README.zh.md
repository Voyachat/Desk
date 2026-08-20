# Aistaff Cloud 一致性组合包

[English](README.md) | 中文

本包是用于无密钥 Cloud 员工体验验收的 `test_only` 确定性组合。它先安装一致性输入 Provider，再安装正常的生产 Provider、Remote 和 Cloud 客户端包装层。

该组合包使用与生产环境相同的 Provider、Remote 和可见客户端路径，只有第一个配置项不同。不得把本包加入生产 Profile 或生产 Cloud 组合包。

## 模型体验

无，因为该仅测试 bundle 只组合一致性 fixture，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；该 bundle 不组装或发送模型请求。

## 已知限制与待办事项

- **仅限测试的组合** —— 该 bundle 使用确定性一致性输入，不得由生产 profile 挂载。
