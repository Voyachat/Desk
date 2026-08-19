# @voyaseek-ai/dsh-agent-memory

[English](README.md) | 中文

Provider 中立的 `ctx.agentMemory` 服务定义，负责有界的跨会话采集、召回、列表、删除和清空合同。

Consumer 传入从可信 Session 派生的作用域。Provider 返回有序条目，不要求跨 Provider 比较数值分数；`MemoryId` 在 Provider 之外保持不透明。`capture()` 对一个 Session 轮次幂等，`forget()` 与 `clear()` 返回实际删除数量。

取消信号作为请求旁路参数传递，因此持久数据不会包含进程本地信号。服务不暴露 Tencent L0–L3 名称、存储路径、凭据或租户身份。

## 模型体验

通过 agent-memory context Consumer 间接产生影响；该 Consumer 把 Provider 结果渲染为已记录的召回消息。

#### KV Cache 影响

服务定义不增加内容；任何缓存影响都由 Consumer 持有。

## 已知限制与暂缓事项

- Provider 必须从可信 Session 与 Host 身份派生作用域，不得接受模型或浏览器提供的身份字段。
- 自动重试要求所选 Provider 遵守采集幂等约定。
