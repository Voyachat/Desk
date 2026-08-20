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

The configured endpoint must implement OpenAI Responses semantics. `provider` is the default Codex model-provider id; `model` is required and becomes its fallback model, while `models`, when non-empty, is its exact admitted model set. Registered LLM routes whose exact model descriptor uses `openai-responses`, has an endpoint, and names a credential reference join the same Runtime automatically. Each turn resolves that route's current endpoint and credential without placing the key in argv. A route using Chat Completions or Anthropic Messages remains excluded and fails before process startup.

`apiKeyEnv` is a credential reference, not a secret value. The driver resolves it through `ctx.credentials` before each turn and injects the value only into that turn's scrubbed child environment. `baseUrl` produces an app-server model-provider override with `wire_api="responses"`. `executable` replaces the `codex` command; `argv` replaces the complete fixed command for controlled deployments. `disposeGraceMs` defaults to 3000 milliseconds.

## Lifecycle and permissions

A fresh DSH Session calls `thread/start` with `ephemeral: false` and records `codex-agent/runtime`; later turns and reconstructed drivers call `thread/resume`. A cross-runtime fork ignores Codex bindings before the latest `agent/runtime/switched` marker, starts a new thread, and supplies a provider-neutral recall of the retained visible transcript on its first turn. One DSH turn contains one step and one Codex `turn/start`. Completed agent messages and deltas become `assistant/message` and `assistant/chunk`; command, file-change, and MCP items become paired `tool/call` and `tool/result` events.

Cancellation sends `turn/interrupt`, terminates the managed process tree, and waits for `waitForExit()` before `whenIdle()` settles. An unexpected server request fails the turn. Command and file-change approvals use `ctx.approval`; without that service they decline. Only the exact `danger-full-access` plus `never` Session policy accepts without prompting. User-input requests currently fail explicitly.

## Upstream

The package pins `@openai/codex` 0.147.0 from [openai/codex](https://github.com/openai/codex), licensed under Apache-2.0. The Harness package uses the public app-server JSON-RPC protocol and does not copy upstream source.

## Model Experience

### Codex app-server turn

#### What the model sees

The assembled DSH system prompt becomes Codex `developerInstructions`. Logged runtime-context snapshots and user text pass through `agent/pre-step`; the global provider/model selection passes through `agent/request` and is then checked against the Runtime's admitted Responses models. On the first turn after a cross-runtime fork, a user-level `recall` message carries retained user, assistant, and tool transcript text; it omits private reasoning and stale plugin context, and represents earlier images with a placeholder. The effective request is reconstructable from `request/header`, `request/context`, and `user/message`. Codex owns its built-in tools, and this text bridge rejects every image or other non-text block in the new turn before startup.

#### Token effect

Developer instructions, retained context, input, cross-runtime recall when present, and Codex-owned tool history consume the durable Codex thread context. App-server usage is not recorded in this implementation.

#### KV Cache effect

Codex owns provider caching and thread history. A fresh app-server process is created per turn so credential changes take effect on the next turn, while `thread/resume` preserves ordinary conversation continuity. A cross-runtime fork intentionally starts a new thread and cannot reuse the source provider thread cache; model or instruction changes can also reduce cache reuse.

## Known Limitations and Deferred Work

- App-server `requestUserInput` is not bridged to `ctx.userQuestions`; it fails the active turn instead of fabricating an answer.
- Permission-range requests fail closed; command and file-change requests are the approval operations currently bridged.
- Usage accounting and per-turn cost reporting are absent.
- Responses compatibility must include streaming events and Codex tool-call semantics. An endpoint that only implements Chat Completions, Anthropic Messages, or a native Gemini protocol is not compatible.
