# 长期记忆

[English](README.md) | 中文

跨会话记忆能力组。`agent-memory` 持有 Provider 中立服务定义，`agent-memory-settings` 是有界的默认本地 Provider，`agent-memory-context` 通过现有 Agent 扩展点采集已完成回合并注入召回历史。

| 包 | 角色 | `ctx` 键 |
| --- | --- | --- |
| `agent-memory` | Service Definition | `agentMemory` |
| `agent-memory-settings` | Service Provider | `agentMemory` |
| `agent-memory-context` | Consumer | — |

## 已知限制与延后工作

默认 Provider 有意在现有本地设置文档中维护有界数据，并且只适用于单个用户的桌面 Home。共享或远程多用户 Host 必须替换成带身份作用域的 Provider。更大个人存储的下一步是专用 SQLite Provider；公共服务使该替换不影响 Agent 和 UI Consumer。TencentDB Agent Memory 在服务端强制认证、严格隔离、带 owner 校验的删除和采集幂等之前保持 opt-in。
