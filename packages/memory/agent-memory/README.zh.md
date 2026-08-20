# @voyaseek-ai/dsh-agent-memory

[English](README.md) | 中文

Provider 中立的 `ctx.agentMemory` 服务定义，负责结构化跨会话采集、后台维护、显式记忆、召回、列表、精确条目编辑、删除和清空。

Consumer 传入从可信 Session 派生的作用域。`capture()` 以确定性标识排队一个已完成轮次；`maintain()` 应用候选感知的 `upsert`／`delete`／`none` mutation，并返回每轮次已提交的变化；`remember()` 显式写入偏好、事实或约束；`update()` 替换一个精确 `MemoryId` 的用户可编辑字段。Provider 返回有序条目，不要求跨 Provider 比较数值分数；`MemoryId` 在 Provider 之外保持不透明。

取消信号作为请求旁路参数传递，因此持久数据不会包含进程本地信号。服务不暴露 Tencent L0–L3 名称、存储路径、凭据或租户身份。

## 模型体验

通过 agent-memory context Consumer 间接产生影响；该 Consumer 把 Provider 结果渲染为已记录的召回消息。

#### KV Cache 影响

服务定义不增加内容；任何缓存影响都由 Consumer 持有。

## 已知限制与暂缓事项

- Provider 必须从可信 Session 与 Host 身份派生作用域，不得接受模型或浏览器提供的身份字段。
- 共享 Host 仍需使用从已认证 Host 上下文派生员工身份的 Provider。
