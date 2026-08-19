# Agent Note：跨会话记忆采用本地 Provider seam

状态：已实现

[English](2026-08-19-bounded-cross-session-agent-memory.md) | 中文

## 问题

持久会话日志与压缩能够恢复一段对话，却不会把用户事实带入一个独立新会话。员工 Agent 需要自动召回，同时记忆必须可检查、可删除、可由用户停用，并与 agent loop 解耦。

TencentDB Agent Memory 提供更丰富的 L0–L3 流程、异步提炼和混合检索，但评审到的 v3 Gateway 不能作为本部署的安全默认值。认证与严格隔离均为可选，请求体可以选择身份范围，删除缺少完整 owner 校验，而对话采集没有幂等键且由 Gateway 生成消息 ID。一次结果不明的写入若重试，可能形成重复记忆。

## 决策

`ctx.agentMemory` 是包含 capture、recall、list、forget 与 clear 操作的 Provider 中立能力。随产品交付的 Provider 在现有用户设置文档中最多保存 200 条有界对话记忆。由 `(session id, turn)` 计算的确定性标识使本地采集幂等，串行设置 mutation 则沿用既有 Settings 并发与 revision 语义。

Consumer 监听已完成的 `turn/end`，只采集直接用户文本与最终 Assistant 消息；工具、推理、流式 chunk、系统消息和召回插件消息均被排除。在后续会话的第一步，`agent/pre-step` 召回同项目条目，把它们标为不可信历史，再追加一条插件来源的 `user/message`。既有循环会在模型请求前记录这条消息，从而在不修改 `agent-loop` 或会话格式的前提下保持“模型可见即已记录”不变量。

记忆管理页通过稳定的 `settings.section` slot 注册，并使用仅限 loopback 且带 revision 保护的 Settings RPC。因此无论 Settings 外壳采用弹窗还是全框架布局，它都无需导入外壳的呈现状态。关闭功能只暂停采集与召回，不删除条目；删除单条和清空全部都需要明确确认。

TencentDB Agent Memory 只登记为架构参考，不成为运行时依赖或代理。待服务强制认证、可信身份绑定、严格隔离、带 owner 校验的删除和幂等采集后，远程 Provider 仍可在 `ctx.agentMemory` 后替换。

## 后果

- 跨会话记忆默认可用，无需服务、凭据、向量数据库或第二套 Agent Runtime。
- 本地文件可由用户查看且有容量上限，但词法检索、整份文档写入与 Home 级身份使其仅适合单用户桌面。共享 Host 必须使用带身份作用域的 Provider。
- SQLite 或加固后的远程 Provider 可以替换存储，而不改变自动采集或召回。不持有本地 Settings namespace 的 Provider 还必须为其数据生命周期提供特权管理适配器。
- 召回失败会降级为只处理当前轮次；采集失败只写日志，不改变已完成会话的结果。

## 考虑过的替代方案

未直接复用会话全文搜索，因为它索引对话历史，却不持有记忆删除、遗忘或有界用户管理生命周期。既有 MCP 示例仍是 opt-in 工具集成，不能保证在模型步骤前自动召回。未采用 Tencent MemoryProxy，因为把模型 base URL 改为启发式 MITM proxy 会让记忆耦合到传输层，并削弱身份控制。
