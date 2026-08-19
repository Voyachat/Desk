# `@voyaseek-ai/dsh-codex-agent`

[English](README.md) | 中文

替代 `codex` AgentDriver 的参考文档。每个 DSH Session 拥有一个持久 Codex thread；每轮通过 `ctx.subprocess` 启动锁定版本 `@openai/codex` 的 app-server，恢复该 thread，把流式记录写入 DSH 日志，并等待完整子进程树退出。

## 组合

将本插件与 `dsh-agent-loop`、`dsh-system-prompt` 和一个 subprocess provider 一起挂载。Session 通过 `agentRuntime: 'codex'` 选择它；没有该 header 的 Session 继续使用默认 loop。

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

配置的 endpoint 必须实现 OpenAI Responses 语义。`provider` 是准确的 Codex model-provider id，也是该 Runtime 唯一接受的 provider route。`model` 必填并作为回退模型；非空 `models` 是准确的允许模型集合。全局选择使用其他 provider 或未列出的模型时，Driver 会在进程启动前失败。

`apiKeyEnv` 是凭据引用，不是 secret 值。Driver 在每轮之前通过 `ctx.credentials` 解析它，只把值注入该轮经过清理的子进程环境。`baseUrl` 会生成 `wire_api="responses"` 的 app-server model-provider override。`executable` 替换 `codex` 命令；`argv` 为受控部署替换完整固定命令。`disposeGraceMs` 默认是 3000 毫秒。

## 生命周期与权限

新的 DSH Session 使用 `ephemeral: false` 调用 `thread/start` 并记录 `codex-agent/runtime`；后续轮次和重建的 Driver 调用 `thread/resume`。一个 DSH turn 包含一个 step 和一个 Codex `turn/start`。完成的 agent message 和 delta 分别成为 `assistant/message` 与 `assistant/chunk`；命令、文件变更和 MCP item 成为配对的 `tool/call` 与 `tool/result` 事件。

取消操作发送 `turn/interrupt`，终止受管进程树，并在 `whenIdle()` 完成前等待 `waitForExit()`。未知 server request 会使该轮失败。命令与文件变更审批使用 `ctx.approval`；没有该服务时会拒绝。只有 Session 恰好处于 `danger-full-access` 与 `never` 才无需提示直接允许。用户输入请求目前会明确失败。

## 模型体验

- **Prompt 与上下文**：DSH system prompt 成为 Codex `developerInstructions`。动态上下文作为 user-role snapshot 写入日志，并在进程启动前经过 `agent/pre-step`。Codex 管理其内建工具；DSH tool schema 不会作为 Codex 工具发送。
- **模型**：全局选择经过 `agent/request`，随后 Runtime 校验配置的 provider 和允许模型。有效 provider、model、system prompt 和 context 可从 `request/header`、`request/context` 与 `user/message` 事件重建。
- **附件**：Driver 仅支持文本，并在 app-server 启动前拒绝所有图片或其他非文本 block。
- **Token**：首个实现不记录 app-server usage。
- **KV cache**：Codex 管理 provider cache 和 thread history。DSH Driver 每轮创建新的 app-server 进程，使凭据变更在下一轮生效，同时通过 `thread/resume` 保留 Codex 对话连续性。

## 上游

本包锁定来自 [openai/codex](https://github.com/openai/codex) 的 `@openai/codex` 0.148.0，其许可证为 Apache-2.0。Harness 包使用公开的 app-server JSON-RPC 协议，不复制上游源码。

## 已知限制与延期工作

- App-server `requestUserInput` 尚未桥接到 `ctx.userQuestions`；它会使当前轮次失败，不会伪造回答。
- Permission-range request 会失败关闭；当前已桥接的审批操作是命令和文件变更请求。
- 尚无 usage 统计和逐轮成本报告。
- Responses 兼容性必须覆盖流式事件和 Codex tool-call 语义。只实现 Chat Completions、Anthropic Messages 或 Gemini 原生协议的 endpoint 不兼容。
