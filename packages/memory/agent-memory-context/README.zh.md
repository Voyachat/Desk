# @voyaseek-ai/dsh-agent-memory-context

[English](README.md) | 中文

排队已完成的用户／助手轮次，通过既有 `ctx.llm` 提炼结构化记忆，经 `agent/pre-step` 注入有界跨会话召回，并注册 `memory_search`、`memory_remember` 与 `memory_forget`。

Consumer 只监听已完成的 `turn/end`。只有直接用户文本会进入提炼；Assistant 消息、系统文本、工具输出、推理、流式内容和插件召回内容均被排除。模型针对 Provider 给出的候选最多生成八个经过验证的 mutation，并且每项写入或删除都必须引用采集用户文本中的精确原话。`memory_remember` 工具对当前直接用户消息执行相同的原话要求。维护限定到来源活动会话，并会在崩溃后的下一次恢复继续处理，因此 Provider 事务提交后，Consumer 才追加携带精确新增、更新与删除 ID 的 `agent-memory/maintenance`。失败调用留在 durable outbox 中做有界重试，也不会改变已完成用户轮次的结果。

用户设置关闭时，Consumer 不会排队已完成轮次或召回已有条目，并从模型组装中移除记忆说明和三个记忆 schema。管理 API 仍可用，因此用户可以在重新开启记忆前检查、删除或清空保留条目。

## 模型体验

### 召回历史

#### 模型看到的内容

第一步时，来自其他会话的相关同项目记忆会出现在当前直接用户输入之前，并带有“不可信历史、当前请求优先”的警告。消息来源为 `kind: agent-memory`、`form: recall`，并携带供管理界面使用的精确条目 ID；AgentLoop 会在模型请求前持久化它。

#### Token 影响

第一份请求最多增加 `maxRecallChars` 个 Unicode code point；后续步骤会复用已记录消息，直至压缩。

#### KV Cache 影响

召回只改变当前会话的请求后缀；系统提示词与更早的稳定前缀仍可复用。

## 已知限制与暂缓事项

- 召回失败时继续执行但不带记忆；Settings 会显示待处理与最终失败数量。
- 提炼质量取决于当前会话路由模型。显式工具可让用户纠正遗漏，但共享 Host 身份仍由 Provider 持有。
