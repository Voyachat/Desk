# Agent Note：Agent 驱动 seam 使 Claude Agent SDK 能够编排 DSH 会话

[English](2026-08-17-claude-agent-sdk-driver-seam.md) | 中文

状态：已实现

## 问题

DSH 会话目前完全由仓库内置的 `ReactLoopAgent` 编排：`AgentLoop` 在 `prepare()` 方法中对该 agent 进行了硬编码。若希望在 Claude Agent SDK 下运行会话（即以 Claude Code 作为编程编排器，并由任意兼容 Claude API 的网关提供端点），则缺乏一个能完整保持会话日志、收件箱、轮次/步骤边界、审批流程，以及创建/恢复生命周期的 seam。对循环逻辑进行 fork 将导致其生命周期机制重复并产生维护偏差；而拦截 `llm/stream` 事件则会篡改 SDK 自身拥有的轮次结构。

## 决策

`agent-loop` 中定义了一个有明确文档说明的扩展点：一个按会话运行时（session runtime）索引的驱动工厂（driver-factory）注册表。`AgentLoop.registerDriverFactory(factory)` 接收一个 `AgentDriverFactory`（含 `runtime` 字段与 `createDriver` 方法）；`constructDriver` 方法在会话创建或恢复时依据 `session.header.agentRuntime` 查找对应驱动工厂——若该字段缺失，则默认使用 `ReactLoopAgent`；若指定了某个已命名但未注册驱动工厂的运行时，则立即报错失败。

该驱动实现了标准 `Agent` 接口，并额外引入作用域（scope）语义，因此其发布、资源释放（dispose）及热模块替换（HMR）行为均由 `agent loop` 统一管理。

`packages/claude/claude-agent` 包注册了 `claude` 运行时，确保集成解耦：官方 SDK 可独立固定版本，该包组可整体迁移至独立仓库；仓库内仅需维护三处耦合点：本能力 seam、`SessionHeader.agentRuntime` 字段（其设计与 `agentPreset` 字段保持一致），以及 `claude-agent/runtime` 会话事件（位于生成的持久化目录中）。

每一轮次中，驱动在会话当前工作目录（cwd）下执行一次 SDK 的 `query()` 调用；将 SDK 消息折叠为持久化事件（如 `assistant/message`、`tool/call`、`tool/result`），并通过 `sourceEventSeqs` 字段建立关联；从 `system/init` 事件中提取并记录 SDK 对话 ID，用于多轮次 `resume`（重启后从日志中恢复）；通过 `dsh-subprocess` 启动 CLI 子进程，并传入经清洗（scrubbed）的父进程环境变量；通过 `canUseTool` 实现工具调用审批桥接（fail-closed 模式）。每次 `query` 均读取最新的持久化会话权限状态：当权限组合为“完全访问 + 无需提示”时，驱动选择 SDK 的 `bypassPermissions` 模式；而受限或交互式权限组合则继续启用审批桥接。显式配置的 `permissionMode` 将覆盖上述会话级映射规则。若 SDK 的权限请求中包含 `suggestions` 字段，桥接层将向 UI 表明该请求可被记忆（rememberable）；UI 可返回 `allowed-and-remembered`，桥接层则将 SDK 完整撰写的更新列表原样作为 `updatedPermissions` 返回。不带 SDK 建议的权限请求无法获得该结果，且 DSH 绝不会基于工具名、参数或路径自行合成任何权限规则。

网关端到端贯穿运行时选择逻辑：`session.create` 接口校验 `agentRuntime` 是否存在于 `driverRuntimes()` 列表中（若不存在则返回 `runtime-not-found` 错误），将其写入会话头（header），回显给客户端，并在摘要信息及 `session-added` 框架中提供该值；拒绝运行时不一致的冷启动恢复（cold resume，报错 `runtime-conflict`）；fork 出的子会话继承该运行时，因为其种子会话（seed session）正是在此运行时下生成的。

浏览器端（`packages/claude/ui-runtime`）占据 composer 的 `conversation.input.left` 插槽：它标识当前会话的运行时，并通过将所属工作区（workspace）切换至所选运行时来完成切换——由于会话自身的运行时不可变更，因此该切换操作实际作用于新创建的、在目标运行时下生成的会话。

## 后果

- 运行时在会话创建时即被固定，其行为与 `agentPreset` 完全一致；恢复（resume）与 fork 操作均不会重新选择运行时。
- Claude 轮次的日志记录最终消息（final messages），而非 token 流：v1 版本将整个 SDK 消息作为原子单元折叠；UI 亦按消息粒度进行渲染。
- DSH 的工具、子 agent 及投影（projections）不在 Claude 轮次内部执行；Claude Code 内置的界面层负责其自身表面（surface）的编排。
- 从 composer 端发起的权限变更，将应用于同一会话中的下一个 Claude 查询；无需为此新建运行时会话。
- 部署方可在任意位置组合该驱动：Aistaff 产品包承载主机行（host row），Web 应用清单（roster）承载芯片（chip）；基础部署则完全不包含该能力。
