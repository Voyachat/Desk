# 长期记忆

[English](README.md) | 中文

跨会话记忆能力组。`agent-memory` 持有 Provider 中立服务定义，`agent-memory-settings` 是由 Settings 配置的 SQLite Provider，`agent-memory-context` 通过现有 Agent 扩展点持有自动提炼、召回与显式工具。

| 包 | 角色 | `ctx` 键 |
| --- | --- | --- |
| `agent-memory` | Service Definition | `agentMemory` |
| `agent-memory-settings` | Service Provider | `agentMemory` |
| `agent-memory-context` | Consumer | — |

## 已知限制与延后工作

默认 Provider 把结构化条目与可恢复提炼 outbox 放在 owner-only SQLite，Settings 只含控制项。它仍仅适用于单个用户的桌面 Home；共享或远程 Host 必须换成带认证身份作用域的 Provider。TencentDB Agent Memory 在服务端强制认证、严格隔离、带 owner 校验的删除和采集幂等之前保持 opt-in。
