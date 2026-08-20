# Agent Note：跨会话记忆采用本地 Provider seam

状态：已实现

[English](2026-08-19-bounded-cross-session-agent-memory.md) | 中文

## 问题

持久会话日志与压缩能够恢复一段对话，却不会把用户事实带入一个独立新会话。员工 Agent 需要自动召回，同时记忆必须可检查、可删除、可由用户停用，并与 agent loop 解耦。

TencentDB Agent Memory 提供更丰富的 L0–L3 流程、异步提炼和混合检索，但评审到的 v3 Gateway 不能作为本部署的安全默认值。认证与严格隔离均为可选，请求体可以选择身份范围，删除缺少完整 owner 校验，而对话采集没有幂等键且由 Gateway 生成消息 ID。一次结果不明的写入若重试，可能形成重复记忆。

## 决策

`ctx.agentMemory` 是包含 capture、maintenance、显式 remember、recall、list、forget 与 clear 操作的 Provider 中立能力。随产品交付的 Provider 把控制项放在 Settings，把结构化数据放在 owner-only SQLite。已完成轮次先经过凭据／secret 检测，再以确定性 `(session id, turn)` 标识进入 durable outbox。因此崩溃会留下可恢复工作，而不是丢失采集或让重试重复写入。

Consumer 监听已完成的 `turn/end`，只采集直接用户文本与最终 Assistant 消息；工具、推理、流式 chunk、系统消息和召回插件消息均被排除。它通过 `ctx.llm` 使用该会话既有路由模型，针对相关候选生成 upsert、delete 或 no-op mutation。用户文本是唯一权威来源，Assistant 输出只用于消歧。Provider 验证每项 mutation，并更新唯一的 `workspace + kind + semantic key`，因此纠正会替换旧值。事件按配置 TTL 过期，失败提炼留在 outbox 中做有界重试。

在后续会话的第一步，`agent/pre-step` 召回相关条目，把它们标为不可信历史，再追加一条携带精确条目 ID、来源为 `agent-memory` 的 `user/message`。既有循环会在模型请求前记录这条消息，从而在不修改 `agent-loop` 或会话格式的前提下保持“模型可见即已记录”不变量。`memory_search`、`memory_remember` 与 `memory_forget` 为 Agent 提供显式纠正路径，无需新增另一项 skill 或 runtime。

记忆管理页通过稳定的 `settings.section` slot 注册。配置继续走带 revision 保护的 `settings.*`，条目则走专用的 `memory.list`、`memory.update`、`memory.forget` 与 `memory.clear`，且全部钉在 loopback。浏览器不会收到数据库路径。关闭功能只暂停采集与召回，不删除条目；删除单条和清空全部都需要明确确认。

自动维护只会在 Provider 事务提交后追加 `agent-memory/maintenance`。对话插件把它投影为低强调状态行，也把召回的 `agent-memory` 消息投影为低强调上下文行。两类行都会把精确条目 ID 交给同一编辑器，因此用户无需离开对话，就能检查保存或调用了什么，并替换错误内容。编辑器通过子 slot 贡献，不会耦合进通用对话包。

TencentDB Agent Memory 只登记为架构参考，不成为运行时依赖或代理。待服务强制认证、可信身份绑定、严格隔离、带 owner 校验的删除和幂等采集后，远程 Provider 仍可在 `ctx.agentMemory` 后替换。

## 后果

- 跨会话记忆默认可用，无需外部服务、凭据、向量数据库、Python runtime 或第二套 Agent Runtime。
- 默认容量是 2,000 条结构化条目，而不是 200 个原始轮次。这是产品资源预算，不是 SQLite 上限；部署仍可配置 `maxEntries`。
- 词法／关键词检索有意避免第二套 embedding seam。自动 pre-step 召回保证日常相关提示会使用记忆，显式工具负责用户主动搜索、纠正与删除。
- 本地 Provider 仍是单用户，项目作用域跟随可信 Session cwd。共享 Host 必须使用带认证身份作用域的 Provider；移动项目目前会形成新的本地作用域。
- 召回失败会降级为只处理当前轮次。采集会在 outbox 中跨进程重启存续；最终失败的维护会在 Settings 可见，且不改变已完成会话结果。
- 可见的“已更新”行表示 Provider 事务已经提交且结果已追加到会话日志；仍在队列中的工作不会显示为已保存。

## 考虑过的替代方案

未直接复用会话全文搜索，因为它索引对话历史，却不持有结构化替换、遗忘、过期或用户管理生命周期。既有 MCP 示例仍是 opt-in 工具集成，不能保证在模型步骤前自动召回。未采用 Tencent MemoryProxy，因为把模型 base URL 改为启发式 MITM proxy 会让记忆耦合到传输层，并削弱身份控制。Mem0、LangMem、Graphiti 与 Letta Code 分别作为 mutation 决策、后台维护、有效期与显式工具的架构输入登记；直接依赖会重复既有 LLM、Agent、存储或语言 runtime。
