# `@voyaseek-ai/dsh-codex-agent`

English | [中文](README.zh.md)

Reference for the alternative `codex` AgentDriver. Each DSH Session owns one durable Codex thread; every turn starts the pinned `@openai/codex` app-server through `ctx.subprocess`, resumes that thread, streams its transcript into the DSH log, and waits for the complete child process tree to exit.

## Composition

Mount this plugin beside `dsh-agent-loop`, `dsh-system-prompt`, and a subprocess provider. A Session selects it with `agentRuntime: 'codex'`; sessions without that header retain the default loop.

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

The configured endpoint must implement OpenAI Responses semantics. `provider` is the exact Codex model-provider id and the only provider route admitted by this Runtime. `model` is required and becomes the fallback model; `models`, when non-empty, is the exact admitted model set. A different global provider or an unlisted model fails before process startup.

`apiKeyEnv` is a credential reference, not a secret value. The driver resolves it through `ctx.credentials` before each turn and injects the value only into that turn's scrubbed child environment. `baseUrl` produces an app-server model-provider override with `wire_api="responses"`. `executable` replaces the `codex` command; `argv` replaces the complete fixed command for controlled deployments. `disposeGraceMs` defaults to 3000 milliseconds.

## Lifecycle and permissions

A fresh DSH Session calls `thread/start` with `ephemeral: false` and records `codex-agent/runtime`; later turns and reconstructed drivers call `thread/resume`. One DSH turn contains one step and one Codex `turn/start`. Completed agent messages and deltas become `assistant/message` and `assistant/chunk`; command, file-change, and MCP items become paired `tool/call` and `tool/result` events.

Cancellation sends `turn/interrupt`, terminates the managed process tree, and waits for `waitForExit()` before `whenIdle()` settles. An unexpected server request fails the turn. Command and file-change approvals use `ctx.approval`; without that service they decline. Only the exact `danger-full-access` plus `never` Session policy accepts without prompting. User-input requests currently fail explicitly.

## Model Experience

- **Prompt and context**: the DSH system prompt becomes Codex `developerInstructions`. Dynamic contexts are logged user-role snapshots and pass through `agent/pre-step` before process startup. Codex owns its built-in tools; DSH tool schemas are not sent as Codex tools.
- **Model**: the global selection passes through `agent/request`, then the Runtime verifies its configured provider and admitted models. The effective provider, model, system prompt, and context are reconstructable from `request/header`, `request/context`, and `user/message` events.
- **Attachments**: the driver is text-only and rejects every image or other non-text block before app-server startup.
- **Tokens**: app-server usage is not recorded in the first implementation.
- **KV cache**: Codex owns provider caching and thread history. The DSH driver creates a fresh app-server process per turn so credential changes take effect at the next turn, while `thread/resume` preserves Codex conversation continuity.

## Upstream

The package pins `@openai/codex` 0.148.0 from [openai/codex](https://github.com/openai/codex), licensed under Apache-2.0. The Harness package uses the public app-server JSON-RPC protocol and does not copy upstream source.

## Known Limitations and Deferred Work

- App-server `requestUserInput` is not bridged to `ctx.userQuestions`; it fails the active turn instead of fabricating an answer.
- Permission-range requests fail closed; command and file-change requests are the approval operations currently bridged.
- Usage accounting and per-turn cost reporting are absent.
- Responses compatibility must include streaming events and Codex tool-call semantics. An endpoint that only implements Chat Completions, Anthropic Messages, or a native Gemini protocol is not compatible.
