# `@voyaseek-ai/dsh-codex-agent`

[English](README.md) | 中文

替代 `codex` AgentDriver 的参考文档。每个 DSH Session 拥有一个持久 Codex thread；每轮通过 `ctx.subprocess` 启动锁定版本 `@openai/codex` 的 app-server，恢复该 thread，把流式记录写入 DSH 日志，并等待完整子进程树退出。

## 组合

将本插件与 `dsh-agent-loop`、`dsh-tools`、`dsh-system-prompt` 和一个 subprocess provider 一起挂载。Session 通过 `agentRuntime: 'codex'` 选择它；没有该 header 的 Session 继续使用默认 loop。

```yaml
- id: codex-agent
  name: '@voyaseek-ai/dsh-codex-agent'
  config:
    provider: dashscope
    model: qwen3.8-max
    models:
      - qwen3.8-max
      - deepseek-v4-flash
    baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    apiKeyEnv: DASHSCOPE_API_KEY
```

配置的 endpoint 必须实现 OpenAI Responses 语义。`provider` 是默认 Codex model-provider id；`model` 必填并作为其回退模型，非空 `models` 是该默认路由的准确允许模型集合。若已注册 LLM 路由的具体模型描述使用 `openai-responses`、具有 endpoint 且指名凭据引用，它会自动加入同一 Runtime。每轮都会重新解析所选路由的当前 endpoint 与凭据，包括 provider id 与已配置默认值相同时；密钥不会进入 argv。使用 Chat Completions 或 Anthropic Messages 的路由仍被排除，并在进程启动前失败。

`apiKeyEnv` 是凭据引用，不是 secret 值。Driver 在每轮之前通过 `ctx.credentials` 解析它，只把值注入该轮经过清理的子进程环境。`baseUrl` 会生成 `wire_api="responses"` 的 app-server model-provider override。Driver 默认从锁定版本 `@openai/codex` 的平台包解析 native executable，因此桌面启动不依赖全局 `codex` 命令或继承的 `PATH`。`executable` 替换该随包 binary；`argv` 为受控部署替换完整固定命令。`disposeGraceMs` 默认是 3000 毫秒。

## 生命周期与权限

新的 DSH Session 使用 `ephemeral: false` 调用 `thread/start` 并记录 `codex-agent/runtime`；后续轮次和重建的 Driver 调用 `thread/resume`。跨 Runtime fork 会忽略最新 `agent/runtime/switched` 标记之前的 Codex 绑定，启动新 thread，并在首轮提供所保留可见 transcript 的提供方无关 recall。一个 DSH turn 包含一个 step 和一个 Codex `turn/start`。完成的 agent message 和 delta 分别成为 `assistant/message` 与 `assistant/chunk`；命令、文件变更和 MCP item 成为配对的 `tool/call` 与 `tool/result` 事件。

取消操作发送 `turn/interrupt`，终止受管进程树，并在 `whenIdle()` 完成前等待 `waitForExit()`。未知 server request 会使该轮失败。命令与文件变更审批使用 `ctx.approval`；没有该服务时会拒绝。只有 Session 恰好处于 `danger-full-access` 与 `never` 才无需提示直接允许。用户输入请求目前会明确失败。

## 上游

本包锁定来自 [openai/codex](https://github.com/openai/codex) 的 `@openai/codex` 0.147.0，其许可证为 Apache-2.0。Harness 包使用公开的 app-server JSON-RPC 协议，不复制上游源码。

## 模型体验

### Codex app-server 轮次

#### 模型看到的内容

组装后的 DSH 系统提示词成为 Codex `developerInstructions`。有日志记录的 Runtime 上下文快照与用户文本经过 `agent/pre-step`；全局 provider／model 选择经过 `agent/request`，随后按该 Runtime 允许的 Responses 模型校验。跨 Runtime fork 后的首轮会增加一条 user 级 `recall` 消息，携带所保留的 user、assistant 与工具 transcript 文本；它会省略私有推理和陈旧插件上下文，并用占位文本表示早先图片。实际请求可从 `request/header`、`request/context` 与 `user/message` 重建。Codex 拥有其内置工具，该文本桥会在启动前拒绝新轮次中的所有图片或其他非文本 block。

#### 对 token 的影响

Developer instructions、保留的上下文、输入、存在时的跨 Runtime recall，以及 Codex 自有工具历史会占用持久 Codex thread 上下文。当前实现不记录 app-server usage。

#### 对 KV Cache 的影响

Codex 拥有 provider cache 与 thread history。每轮使用新的 app-server 进程，使凭据变更在下一轮生效；`thread/resume` 保留普通对话连续性。跨 Runtime fork 会有意启动新 thread，因此不能复用源 provider 的 thread cache；模型或指令变化也可能降低 cache 复用率。

## 已知限制与延期工作

- App-server `requestUserInput` 尚未桥接到 `ctx.userQuestions`；它会使当前轮次失败，不会伪造回答。
- Permission-range request 会失败关闭；当前已桥接的审批操作是命令和文件变更请求。
- 尚无 usage 统计和逐轮成本报告。
- Responses 兼容性必须覆盖流式事件和 Codex tool-call 语义。只实现 Chat Completions、Anthropic Messages 或 Gemini 原生协议的 endpoint 不兼容。
