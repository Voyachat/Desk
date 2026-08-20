# @voyaseek-ai/dsh-claude-agent

[English](README.md) | 中文

DSH 会话的 Claude Agent SDK 驱动：以 `claude` runtime 创建的会话由 Claude Code（通过官方 `@anthropic-ai/claude-agent-sdk`）编排，而不是默认的 DSH ReactLoopAgent。本包是 Claude 集成的 host 部分；浏览器部分为 `@voyaseek-ai/dsh-claude-runtime-ui`（编辑器 runtime 选择器）。

## 工作方式

`agent-loop` 提供按会话 runtime 标识的驱动工厂注册表。本包为 `claude` runtime 注册工厂；`AgentLoop` 在创建或恢复时读取 `session.header.agentRuntime`，并为 Claude 会话构建 `ClaudeSdkAgent`。该驱动：

- 与默认循环一样拥有 turn／step 边界和 inbox，因此会话日志仍是事实来源；
- 组装与本机循环相同的作用域系统提示词和动态上下文，执行 `agent/pre-step` 与 `agent/request`，并在每次 SDK query 前把实际 provider／model／system 快照记录到 `request/header`；
- 在会话 cwd 中每轮运行一次 SDK `query()`，并将 SDK 消息映射到持久会话事件：`system/init` 记录 `claude-agent/runtime` 事件（SDK 会话 id 与模型），assistant 文本／思考／工具块折叠为 `assistant/message` 和 `tool/call`，SDK 工具结果折叠为通过 `sourceEventSeqs` 关联调用的 `tool/result`；
- 跨轮次把已记录的 SDK 会话 id 作为 `resume` 传入，并在重启后从日志恢复该 id；
- 跨 Runtime fork 后忽略最新 `agent/runtime/switched` 标记之前的 Claude 会话 id，并使用所保留可见 transcript 的提供方无关 recall 来启动新的 SDK 对话；
- 通过 `dsh-subprocess` 和清理后的父环境启动 Claude Code CLI，因此 SDK 子进程只继承预期的 `ANTHROPIC_*` endpoint 与凭据。

任何兼容 Claude API 的 endpoint 都可使用：`baseUrl`／`authToken`／`apiKey`／`model` 分别映射到 `ANTHROPIC_BASE_URL`／`ANTHROPIC_AUTH_TOKEN`／`ANTHROPIC_API_KEY`／`ANTHROPIC_MODEL`；未设置字段继续使用父环境，因此第三方 gateway 只需提供相应环境变量。

若已注册 LLM 路由的具体模型描述使用 `anthropic-messages`、具有 endpoint 且指名凭据引用，它会自动加入 Claude 模型选择器。Driver 每次 query 都重新解析该路由的当前 endpoint 与凭据。OpenAI Responses 与 Chat Completions 路由不会被呈现为 Claude 兼容，即使同一个账户密钥能够认证它们。

SDK `canUseTool` hook 承载两类不同交互。`AskUserQuestion` 委托给 host 问题服务，并把答案返回 Claude，绝不打开审批面板。其他权限请求委托给 host 审批服务；缺少该服务时按拒绝处理。

未显式配置 `permissionMode` 时，每次 query 都读取最新会话权限事件。`read-only` 使用 SDK `default`；`workspace-write` 加 `ask` 使用基于分类器的 `auto`；`danger-full-access` 加 `never` 仍使用 SDK `default` 以保留提问交互，同时 bridge 直接放行所有非提问工具。显式 `permissionMode` 仍是部署级覆盖。需要原始 SDK 姿态的部署可以显式选择 `bypassPermissions`，但该模式会在 `canUseTool` 之前解析工具，因此 SDK 无法把 `AskUserQuestion` 交给 host。

只有 Claude 的整批建议全部是同一工具、`type: addRules`、`behavior: allow`、`destination: session` 时，审批面板才提供记住操作。接受后的规则会传给同一存活 driver 的下一次 SDK query 子进程。混合更新、settings 文件目的地、模式切换、目录授权、deny 规则和跨工具规则都只能单次允许；通用审批面板绝不会让 DSH 写入 Claude 的用户、项目或本机 settings。这类记住规则不会跨应用或 driver 重启保留。

## 配置

| key | 默认值 | 含义 |
| --- | --- | --- |
| `runtime` | `claude` | 此工厂服务的 session header runtime |
| `provider` | `claude-agent` | 此 Anthropic 兼容 endpoint 服务的全局模型 provider route |
| `model` | 未设置 | SDK 子进程的 `ANTHROPIC_MODEL` 覆盖 |
| `models` | 未设置 | endpoint 明确支持的模型 id，同时过滤该会话的模型选择器 |
| `baseUrl` | 未设置 | `ANTHROPIC_BASE_URL` 覆盖（兼容 gateway） |
| `authToken` | 未设置 | `ANTHROPIC_AUTH_TOKEN` 覆盖 |
| `apiKey` | 未设置 | `ANTHROPIC_API_KEY` 覆盖 |
| `apiKeyEnv` | 未设置 | 每次 query 解引用并作为 `ANTHROPIC_API_KEY` 注入的凭据名称 |
| `permissionMode` | 会话权限状态 | 显式 SDK 权限模式（`default`、`acceptEdits`、`auto`、`plan`、`bypassPermissions`） |
| `executable` | SDK 解析 | 显式 Claude CLI 路径（`pathToClaudeCodeExecutable`） |
| `env` | `{}` | 叠加到清理后父环境的子进程环境项 |
| `disposeGraceMs` | `3000` | 取消 SDK 子进程后终止前的宽限毫秒数 |

## 模型体验

### Claude SDK 请求

#### 模型看到的内容

组装后的 DSH 系统提示词成为 SDK 自定义系统提示词。有日志记录的动态上下文快照与用户文本经过 `agent/pre-step`；全局 provider／model 选择经过 `agent/request`，成为该次请求的实际模型。跨 Runtime fork 后的首轮会增加一条 user 级 `recall` 消息，携带所保留的 user、assistant 与工具 transcript 文本；它会省略私有推理和陈旧插件上下文，并用占位文本表示早先图片。Claude Code 拥有其内置工具，因此 DSH 工具 schema 不会作为 Claude 工具呈现。该文本桥会在请求前拒绝新轮次中的图片及所有其他非文本 block。

#### 对 token 的影响

自定义系统提示词、保留的上下文快照、用户输入、存在时的跨 Runtime recall，以及 Claude 自有工具 transcript 会占用 SDK 对话上下文。当前版本的 DSH 不记录 Claude token 数量。

#### 对 KV Cache 的影响

Claude 拥有 `~/.claude` 下的对话缓存；DSH 在普通轮次之间保留 SDK Session id。跨 Runtime fork 会有意启动新的 SDK 对话，因此不能复用源 provider 的对话 cache；改变所选模型或组装后的系统提示词也可能使 cache 无法复用。

## 已知限制与暂缓事项

- 没有 `assistant/chunk` 流式输出：transcript 折叠最终 SDK 消息，因此 UI 按消息而不是按 token 渲染 Claude 回复。
- DSH 工具、subagent 和投影不参与 Claude 轮次；编排完全使用 Claude Code 内置界面。
- `claude-agent/runtime` 会话事件位于仓库内：持久化通过生成目录识别它；如果本包移出仓库，携带该事件的旧日志需要挂载本包，直至 append API 支持插件可忽略事件。
- Token／用量统计和逐轮成本报告尚未实现。
- Claude 权限模式与本机 DSH 文件沙箱共享产品级意图，但不是同一种操作系统强制实现；UI 不能声称二者具有相同的内核隔离或网络控制能力。
