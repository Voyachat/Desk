# @voyaseek-ai/dsh-agent-memory-context

[English](README.md) | 中文

采集已完成的用户/助手回合，并通过 `agent/pre-step` 注入有界且标注来源的跨会话召回。召回文本被明确视为不受信任的历史数据。

Consumer 只监听已完成的 `turn/end`。它保留直接用户文本与最终 Assistant 消息，并排除系统、工具、推理、流式和插件召回内容。`maxRecallChars` 默认为 6000 个 Unicode code point。

## 模型体验

### 召回历史

#### 模型看到的内容

第一步时，来自其他会话的相关同项目记忆会出现在当前直接用户输入之前，并带有“不可信历史、当前请求优先”的警告。消息来源为 `plugin: agent-memory-context`、`form: recall`；AgentLoop 会在模型请求前持久化它。

#### Token 影响

第一份请求最多增加 `maxRecallChars` 个 Unicode code point；后续步骤会复用已记录消息，直至压缩。

#### KV Cache 影响

召回只改变当前会话的请求后缀；系统提示词与更早的稳定前缀仍可复用。

## 已知限制与暂缓事项

- 召回失败时继续执行但不带记忆，异步采集失败只记录警告。
- 排序、提炼、身份作用域与遗忘策略仍由 Provider 持有。
