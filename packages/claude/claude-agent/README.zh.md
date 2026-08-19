# @voyaseek-ai/dsh-claude-agent

[English](README.md) | 中文

DSH 会话的 Claude Agent SDK 驱动：以 `claude` runtime 创建的会话由 Claude Code（通过官方 `@anthropic-ai/claude-agent-sdk`）编排，而不是默认的 DSH ReactLoopAgent。本包是 Claude 集成的 host 部分；浏览器部分为 `@voyaseek-ai/dsh-claude-runtime-ui`（编辑器 runtime 选择器）。

## 工作方式

`agent-loop` 提供按会话 runtime 标识的驱动工厂注册表。本包为 `claude` runtime 注册工厂；`AgentLoop` 在创建或恢复时读取 `session.header.agentRuntime`，并为 Claude 会话构建 `ClaudeSdkAgent`。该驱动：

- 与默认循环一样拥有 turn／step 边界和 inbox，因此会话日志仍是事实来源；
- 在会话 cwd 中每轮运行一次 SDK `query()`，并将 SDK 消息映射到持久会话事件：`system/init` 记录 `claude-agent/runtime` 事件（SDK 会话 id 与模型），assistant 文本／思考／工具块折叠为 `assistant/message` 和 `tool/call`，SDK 工具结果折叠为通过 `sourceEventSeqs` 关联调用的 `tool/result`；
- 跨轮次把已记录的 SDK 会话 id 作为 `resume` 传入，并在重启后从日志恢复该 id；
- 通过 `dsh-subprocess` 和清理后的父环境启动 Claude Code CLI，因此 SDK 子进程只继承预期的 `ANTHROPIC_*` endpoint 与凭据。

任何兼容 Claude API 的 endpoint 都可使用：`baseUrl`／`authToken`／`apiKey`／`model` 分别映射到 `ANTHROPIC_BASE_URL`／`ANTHROPIC_AUTH_TOKEN`／`ANTHROPIC_API_KEY`／`ANTHROPIC_MODEL`；未设置字段继续使用父环境，因此第三方 gateway 只需提供相应环境变量。

SDK `canUseTool` hook 承载两类不同交互。`AskUserQuestion` 委托给 host 问题服务，并把答案返回 Claude，绝不打开审批面板。其他权限请求委托给 host 审批服务；缺少该服务时按拒绝处理。

未显式配置 `permissionMode` 时，每次 query 都读取最新会话权限事件。`read-only` 使用 SDK `default`；`workspace-write` 加 `ask` 使用基于分类器的 `auto`；`danger-full-access` 加 `never` 仍使用 SDK `default` 以保留提问交互，同时 bridge 直接放行所有非提问工具。显式 `permissionMode` 仍是部署级覆盖。需要原始 SDK 姿态的部署可以显式选择 `bypassPermissions`，但该模式会在 `canUseTool` 之前解析工具，因此 SDK 无法把 `AskUserQuestion` 交给 host。

只有 Claude 的整批建议全部是同一工具、`type: addRules`、`behavior: allow`、`destination: session` 时，审批面板才提供记住操作。接受后的规则会传给同一存活 driver 的下一次 SDK query 子进程。混合更新、settings 文件目的地、模式切换、目录授权、deny 规则和跨工具规则都只能单次允许；通用审批面板绝不会让 DSH 写入 Claude 的用户、项目或本机 settings。这类记住规则不会跨应用或 driver 重启保留。

## 配置

| key | 默认值 | 含义 |
| --- | --- | --- |
| `runtime` | `claude` | 此工厂服务的 session header runtime |
| `model` | 未设置 | SDK 子进程的 `ANTHROPIC_MODEL` 覆盖 |
| `baseUrl` | 未设置 | `ANTHROPIC_BASE_URL` 覆盖（兼容 gateway） |
| `authToken` | 未设置 | `ANTHROPIC_AUTH_TOKEN` 覆盖 |
| `apiKey` | 未设置 | `ANTHROPIC_API_KEY` 覆盖 |
| `permissionMode` | 会话权限状态 | 显式 SDK 权限模式（`default`、`acceptEdits`、`auto`、`plan`、`bypassPermissions`） |
| `executable` | SDK 解析 | 显式 Claude CLI 路径（`pathToClaudeCodeExecutable`） |
| `env` | `{}` | 叠加到清理后父环境的子进程环境项 |
| `disposeGraceMs` | `3000` | 取消 SDK 子进程后终止前的宽限毫秒数 |

## 模型体验

- **提示词**：本轮用户提示文本原样交给 Claude Code；DSH 系统提示词和 DSH 工具 schema 不参与，Claude Code 使用自己的提示词与内置工具。
- **Tokens**：用量记账由 SDK 拥有；v1 中 DSH 不记录 Claude 轮次的 token 数量。
- **KV cache**：DSH 不为该驱动构建模型请求；SDK 在 `~/.claude` 下拥有自己的会话缓存。

## 已知限制与暂缓事项

- 没有 `assistant/chunk` 流式输出：transcript 折叠最终 SDK 消息，因此 UI 按消息而不是按 token 渲染 Claude 回复。
- DSH 工具、subagent 和投影不参与 Claude 轮次；编排完全使用 Claude Code 内置界面。
- `claude-agent/runtime` 会话事件位于仓库内：持久化通过生成目录识别它；如果本包移出仓库，携带该事件的旧日志需要挂载本包，直至 append API 支持插件可忽略事件。
- Token／用量统计和逐轮成本报告尚未实现。
- Claude 权限模式与本机 DSH 文件沙箱共享产品级意图，但不是同一种操作系统强制实现；UI 不能声称二者具有相同的内核隔离或网络控制能力。
