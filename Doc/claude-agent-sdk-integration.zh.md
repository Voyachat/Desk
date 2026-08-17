# Claude Agent SDK 作为 DSH 插件集成：分析与设计

English summary: integrate the official Claude Agent SDK as a decoupled DSH plugin group — a
driver-factory extension point on `agent-loop`, a `packages/claude` plugin group providing an
alternative `Agent` driver over the SDK, and a composer run-mode selector (本机模式 / Claude 模式).

## 1. 目标

- 用 Claude（Claude Agent SDK / Claude Code 内核）作为编程任务的**核心调度**：模型循环、工具
  调用、任务规划都由 SDK 驱动，而不是 DSH 的 ReactLoopAgent。
- 支持**任意 Claude API 兼容 key**：第三方中转网关只要兼容 Anthropic Messages API，就可以通过
  `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` 注入 SDK 子进程。
- 聊天窗口中、模式选择（plan chip）右侧提供**运行模式选择器**：本机模式（DSH）/ Claude 模式。
- **与 DSH 解耦**：Claude 集成是独立插件组（可单独成仓/单独拉取），依赖 npm 上的开源
  `@anthropic-ai/claude-agent-sdk`；DSH 侧只保留一个最小且稳定的驱动扩展点，两边各自升级。

## 2. 现状分析（DSH 关键机制）

| 机制 | 位置 | 与本需求的关系 |
|---|---|---|
| Agent 接口 / AgentRegistry | `packages/core/agent` | 任何驱动都实现同一个 `Agent` 接口；注册表是 UI/API 看到的唯一事实 |
| AgentFactory（单一槽位） | `ctx.agents.setFactory` | `AgentLoop` 独占工厂槽位；`session.create/prompt` 全部经 `ctx.agents.create/resume` |
| ReactLoopAgent 驱动 | `packages/core/agent-loop` | 默认驱动；`prepare()` 中硬编码 `new ReactLoopAgent` —— **需要扩展点** |
| Session 日志 | `packages/core/session` | `turn/start…turn/end` 等持久事件是 UI 渲染/回放/持久化的唯一来源；任何驱动都必须写同一套事件 |
| 先例：subagent-claude-code | `packages/subagent/subagent-claude-code` | 已经以官方 SDK 作为一次性 subagent：进程管理（`spawnClaudeCodeProcess` → dsh-subprocess）、env 清洗、结果收敛均可复用其模式 |
| UI 座位系统 | `packages/client/ui-conversation` | composer 工具行有 `conversation.input.plan`（模式 chip）与 `conversation.input.left`（其后的列表座位）——运行模式选择器作为**独立客户端插件**占用列表座位，无需改 ui-conversation |
| agentPreset 先例 | `packages/preset` + api-proxy | “会话创建时固定组合、写入 header、恢复时重建”的完整范式；运行模式按同一范式落 header |

### 2.1 为什么不能直接注册第二个工厂

`AgentRegistry.setFactory()` 在已注册时抛错；一个进程只能有一个 `AgentFactory`。
“本机/Claude 两种会话并存”因此只有两条路：

1. **替换组合行**：用 patch 层把 `agent-loop` 行换成自研路由插件 —— 需要复刻 AgentLoop 的
   生命周期机制（prepare/publish/ownership，~300 行），且随 DSH 升级持续漂移，违背“用最新版本”。
2. **在 AgentLoop 上加驱动扩展点**：AgentLoop 保留工厂与全部生命周期机制，只在构造驱动一步咨询
   已注册的驱动工厂；无匹配时行为与今天完全一致。**本方案选 2。**

其它被否决的路径：
- *把 Claude 当作 LLM provider*（llm 适配层）：模型调度仍是 DSH 循环，不是“Claude 核心调度”。
- *劫持 `llm/stream` 瀑布*：ReactLoopAgent 仍拥有 turn/step 记账，伪造单条 assistant 消息 +
  旁路追加工具事件会造成 turn 结构与事件配对脆弱，取消/转向语义错位。
- *preset 组合内替换驱动*：preset `setup` 契约是“只组合、不驱动”，工厂仍造 ReactLoopAgent。

## 3. 总体架构

```
浏览器 UI（chat window）
  └─ ui-runtime 插件：composer 工具行座位 conversation.input.left
       ├─ 显示当前会话运行模式（本机 / Claude）
       └─ 空白会话：切换 → RPC session.selectRuntime；新会话：暂存默认
            │ RPC
宿主 api-proxy（session.create / selectRuntime / resume）
  └─ ctx.agents.create/resume（meta.agentRuntime 持久化于 SessionHeader）
       └─ AgentLoop 工厂（唯一工厂，生命周期机制不变）
            ├─ runtime 未注册驱动 → ReactLoopAgent（DSH 本机模式，原行为）
            └─ runtime=claude 匹配 → ClaudeSdkAgent（packages/claude 提供）
                 └─ 官方 @anthropic-ai/claude-agent-sdk query()
                      ├─ env: ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY（任意兼容 key）
                      ├─ resume: claudeSessionId（多轮续接，SDK 自持会话存储）
                      ├─ canUseTool → ctx.approval（DSH 审批策略约束）
                      └─ SDKMessage 流 → 持久 SessionEvent（UI 零改动渲染）
```

### 3.1 驱动扩展点（agent-loop 的最小改动）

```ts
/** 可替代 ReactLoopAgent 的驱动契约：Agent 接口 + 可拆除的 agent 作用域。 */
export interface AgentDriver extends Agent {
  /** 驱动自持的 agent 作用域；生命周期拆除时由工厂调用。 */
  readonly scope: Scope
}

export interface AgentDriverFactory {
  /** 该工厂服务的运行模式标识（写入 SessionHeader.agentRuntime）。 */
  readonly runtime: string
  /** 为一个已准备好的 session 构造驱动（不发布、不驱动）。 */
  createDriver(input: { ctx, id, options, session, signal }): AgentDriver | Promise<AgentDriver>
}

// AgentLoop 新增：
registerDriverFactory(factory: AgentDriverFactory): () => void  // effect-scoped，重复 runtime 抛错
```

`prepare()` 在 `new ReactLoopAgent` 之前按 `session.header.agentRuntime` 匹配已注册工厂；
未匹配（缺省）走原路径。发布、拆除、取消、whenIdle 等全部沿用现有机制 —— 自定义驱动只需实现
`Agent` + `scope`。

### 3.2 ClaudeSdkAgent（packages/claude/claude-agent）

实现 `Agent` 接口的完整语义：

- **inbox**：复用 `dsh-agent` 导出的 `Inbox`（持久待办消息投影），`send/followup/steer/inject`
  语义与默认驱动一致（Claude 模式下 steer/inject 归并为下一轮提示文本）。
- **turn 驱动**：唤醒 → `turn/start` → 认领消息 → `step/start` + `user/message` →
  SDK `query()` → 事件映射 → `step/end` → `turn/end`。一次 query 内 SDK 自行多步
  （模型+工具循环），DSH 侧记为一个 step 内的连续事件流。
- **事件映射**（SDKMessage → SessionEvent）：

| SDK 消息 | DSH 事件 |
|---|---|
| `system/init` | 记录 claudeSessionId（驱动私有状态，随 `claude/runtime` 事件持久化） |
| `assistant` 文本/思考块 | `assistant/message`（v1 不转 chunk；UI 回放走消息折叠） |
| `assistant` tool_use 块 | `tool/call`（callId=name/arguments 原样） |
| `user`（tool_result 块） | `tool/result`（sourceEventSeqs 指向配对 call） |
| `result` | 汇总 usage → `turn/end { reason: completed }；错误子类 → error/aborted |

- **多轮**：首轮 query 从 init 拿到 claudeSessionId 并追加 `claude/runtime` 会话事件；
  后续 turn 用 `resume: claudeSessionId`。进程重启后从日志恢复该 id（resume 会话）。
- **key 兼容**：配置字段 `baseUrl`/`authToken`/`apiKey`/`model`/`env` → 注入 SDK `env`：
  `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`（或 `ANTHROPIC_API_KEY`）、`ANTHROPIC_MODEL`。
  凭据支持 `dsh-credentials` 引用（`!!js` / settings 注入），绝不落日志。
- **DSH 约束（审批）**：`canUseTool` 回调把工具请求转成 `ctx.approval.request`
  （ask/never 策略、fail-closed 与 DSH 工具管线一致）；另提供 `permissionMode` 配置直通。
- **进程治理**：复用 subagent-claude-code 的模式 —— `spawnClaudeCodeProcess` 钩子把 CLI 进程交给
  `dsh-subprocess`（凭据清洗 env、进程树终止、退出等待）；`cancel()` = AbortController +
  `query.interrupt()/close()` + 进程树终止升级。

### 3.3 API / 持久化

- `SessionHeader.agentRuntime?: string` + `CreateAgentOptions.meta.agentRuntime`（与
  `agentPreset` 完全同构：创建时固定、恢复时按 header 重建）。
- `session.create` 接受 `agentRuntime`，未知值 → `runtime-not-found`（列出已注册 runtime）。
- 新增 `session.selectRuntime`：仅空白会话可切换 —— 丢弃并重建其空闲 agent（空白会话无历史，
  重建零代价）；非空白 → `runtime-locked`。

### 3.4 UI（packages/claude/ui-runtime）

独立客户端插件，占用现有 `conversation.input.left` 列表座位（plan chip 右侧），不改
ui-conversation：

- 显示当前会话运行模式徽标：本机模式 / Claude 模式；
- 空白会话：下拉切换（RPC `session.selectRuntime`）；
- 非空白会话：只读 + 提示“新会话生效”；
- 新会话屏：暂存默认运行模式（settings `claude-runtime.default`），与 agentPreset hero chip 同范式。

## 4. 解耦与升级策略

| 部件 | 归属 | 升级方式 |
|---|---|---|
| 驱动扩展点 | DSH `agent-loop`（一次最小改动 + 架构文档） | 随 DSH 升级；契约面极小（Agent + scope） |
| `packages/claude/*` | 独立插件组（可拆独立仓库，经 bundle 安装） | 独立拉取/发版 |
| `@anthropic-ai/claude-agent-sdk` | npm 依赖（pinned，现有 0.3.x） | `pnpm update` 独立升级；第三方分发授权同 subagent-claude-code 先例 |
| UI 运行模式选择器 | `packages/claude/ui-runtime`（dsh.client 行） | 随插件组升级 |

不装 claude 插件组时：DSH 行为与今天完全一致（扩展点空转）；装了但 key 未配置时：Claude 模式
会话在首次 turn 明确报错（fail loud），不影响本机模式。

## 5. 分期落地

- **P0（本次交付）**：扩展点 + 类型 + ClaudeSdkAgent（turn/消息/工具事件映射、resume、env key、
  取消/拆除）+ session.create/selectRuntime + composer 选择器 + 单元测试与组合接线。
- **P1**：`assistant/chunk` 实时流式（`includePartialMessages`）、审批策略细粒度（逐工具
  allowlist）、claude 计划模式与 DSH plan 模式互通、usage/token 统计精确化。
- **P2**：快照/e2e 全量门禁、独立仓库拆分与 bundle 分发、Windows 批处理 shim 完整验证。

## 6. 风险与限制

- SDK 自持会话存储（`~/.claude`）与 DSH 日志是两份事实：DSH 日志是 UI/回放事实，SDK 存储是模型
  上下文事实；删除会话需同时清理（P1）。
- “model-visible ⟺ logged”在 Claude 模式下按“转录事实”解释：DSH 日志忠实记录模型可见的输入
  （用户消息）与输出（assistant/工具事件），模型侧上下文由 SDK resume 保证一致。
- Claude 模式暂不支持 DSH 工具（tools 注册表）与 subagent 委托 —— SDK 用自己的内置工具；
  DSH 工具互通走 MCP 桥（P1/P2，SDK 支持 mcpServers 配置，可把 dsh 工具暴露为 MCP）。
## 7. 落地情况（实现记录）

P0 已按本设计落地，其中一处范围调整：

- **空白会话的 selectRuntime 未实现为原位切换**：宿主没有会话删除/重建通道
  （api-proxy 不持有 AgentHandle、持久化层无 remove API），原位换 runtime 需要
  新增整条拆除路径。实际落地为“创建时选择 + 切换即换会话”：`session.create`
  接受并校验 `agentRuntime`（`runtime-not-found`/`runtime-conflict`），composer
  芯片切换时以目标 runtime 连接当前工作区（复用同 runtime 的空白会话，否则新建）
  并打开落点会话。会话终身携带创建时的 runtime，与 agentPreset 语义对齐。
- **选择器 roster v1 为静态两档**（本机/Claude）：后续读取宿主
  `driverRuntimes()` 注册表即可扩展到更多驱动（已写入 ui-runtime 的 Known
  Limitations）。
- 组合接线：宿主驱动行落在 Aistaff 产品 bundle（`packages/aistaff/product-bundle`
  的 cordis.patch.yml），浏览器芯片行落在 web-app roster；base 部署两者皆无。
