# Agent Note：每个对话选择一种持久 Agent Runtime

Status: implemented

[English](2026-08-20-conversation-agent-runtimes.md) | 中文

## 问题

产品已有本机循环和可选的 Claude Agent SDK 驱动，但 Runtime 选择器是静态二选一控件，且两个会话持久化后端都没有保存所选 Runtime。替代驱动还绕过了本机循环的系统提示词组装与模型选择 hook。若不先修正这些接缝就加入 Codex，对话可能在重启后静默回到本机循环，界面也可能展示当前协议无法调用的模型，或遗漏全局注入的上下文和策略。

三种执行引擎接受的 wire protocol 不同。本机 DashScope adapter 使用 OpenAI Chat Completions，Claude 通过 Agent SDK 使用 Anthropic Messages，而 Codex app-server 要求 OpenAI Responses 语义。同一份凭据对应的 endpoint 可能只在不同协议上支持不同模型子集。

## 决策

每个对话在 `SessionHeader.agentRuntime` 中选择且只选择一种 Runtime：字段缺省表示本机 DSH 循环，`claude` 表示 Claude Agent SDK 驱动，`codex` 表示官方 Codex app-server 驱动。该 header 对当前会话不可变，并由 JSONL 与 SQLite 持久化。从空白会话选择其他模式时，在同一 Workspace 打开或复用匹配的空白会话。从所保留的已完成历史切换时，创建并打开一个由 header 选择目标 Runtime 的子 fork；源会话保持不变。未提供目标 Runtime 的普通 fork 仍继承源 Runtime。

跨 Runtime fork 会把 `agent/runtime/switched` 追加到构造种子中。替代驱动仅在自身 Runtime 事件位于该标记之后时接受提供方续接 id；因此经过其他 Runtime 的工作后再切回时，会启动新的提供方 thread，而不会恢复已经陈旧的隐藏历史。该替代 Runtime 的新首轮会增加一条 user 级 `recall` 消息，其中包含所保留的 user、assistant 与工具 transcript 文本。它会排除提供方私有推理与陈旧插件上下文，用占位文本表示早先图片，并继续单独接收新组装的全局上下文。UI 会瞬时提示：在对话内切换可能降低执行效果。

三种 Runtime 都仍是 DSH agent。它们接收同一份持久 Session、cwd、全局权限事件、凭据引用、组装后的系统提示词、Runtime 上下文投影、`agent/pre-step` 与 `agent/request` 模型选择 waterfall。每个替代驱动在调用 SDK 前，把实际 provider、model、系统提示词和上下文记录进 Session。凭据每轮解析，只进入清理后的子进程环境。Claude 的嵌入式 query 不读取用户或项目的 Claude settings；Codex 接收显式的 Responses provider 配置。它们的子进程树都由 `dsh-subprocess` 拥有并等待退出。

`Agent.modelConstraint` 描述替代 Runtime 真正能够发送的 provider 与 model id。会话模型目录按该约束过滤；全局默认不兼容时解析为 Runtime 的配置默认值；不兼容的选择在启动进程前被拒绝。这是协议能力路由，并不宣称名称相近的模型可以互换。当前 DashScope 组合在本机模式接纳 Kimi K3、Qwen 3.8 Max 和 DeepSeek V4 Flash；其 Anthropic Messages 与 Responses endpoint 在 Claude 和 Codex 模式接纳 Qwen 3.8 Max 与 DeepSeek V4 Flash。

Claude 与 Codex 保留各自的内置工具 Runtime，同时 DSH 拥有权限决策与持久审计事件。命令和文件变更请求桥接到 DSH 审批；没有审批方时失败关闭。当前文本桥会明确拒绝图片和其他非文本内容，而不是将其丢弃。

## 后果

- Runtime 选择器提供三个独立选项，其标签始终来自当前对话 header。
- 用户可以从已有对话选择其他 Runtime 而不丢失可见历史，但提供方私有 thread 状态、工具状态、审批、推理和 cache 不会转移；系统不承诺执行效果完全一致。
- 重启、列表、恢复与 fork 都保留 Runtime 身份；未知 Runtime 会在会话创建或恢复时明确失败。
- 全局 AI 配置与上下文在 Host 接缝共享；provider 专属的执行、续接 id、工具和流式输出仍由各驱动拥有。
- 全局模型选择不能再显示成功却被 Claude 或 Codex 忽略；不受支持的协议／模型组合会被隐藏或拒绝。
- 当前随产品交付的 DashScope 组合只在本机模式提供 Kimi K3。未来要把它加入 Claude 或 Codex，必须先取得对应 Anthropic Messages 或 Responses endpoint 支持它的证据。
- Codex app-server 的用户输入请求与用量记账仍是明确的后续工作。Claude 与 Codex 尚未把 DSH 工具 schema 作为 provider 原生工具接入。

## 考虑过的替代方案

没有采用 Codex TypeScript SDK 作为桌面主 Runtime，因为它的基础 thread API 没有暴露 Host 所需的完整审批、中断与 item 生命周期。官方 app-server 协议保留了这些能力，同时让 DSH 继续拥有持久 Session 与权限。

没有复用既有的一次性 Codex subagent，因为它没有续接、进度、审批或流式合同。没有把所有模型转换到一个名义上 OpenAI 兼容的 endpoint，因为实际 DashScope 协议支持不同模型集合。没有原地修改单个会话的 Runtime，因为 SDK thread id、工具历史、审批状态与 replay 语义属于创建该历史的驱动。目标 Runtime fork 会保留源会话与可见 transcript，同时为新驱动提供明确的提供方状态重置。
