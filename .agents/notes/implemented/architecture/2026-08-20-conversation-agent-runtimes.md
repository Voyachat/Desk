# Agent Note: conversations select one durable agent runtime

Status: implemented

English | [中文](2026-08-20-conversation-agent-runtimes.zh.md)

## Problem

The product had a native loop and an optional Claude Agent SDK driver, but the runtime picker was a static two-item control and the selected runtime was not persisted by either session backend. Alternative drivers also bypassed the native loop's system-prompt assembly and model-selection hooks. Adding Codex without correcting those seams would make a conversation silently return to the native loop after restart, show model choices the active protocol could not call, or omit globally supplied context and policy.

The three execution engines do not accept the same wire protocol. The native DashScope adapter uses OpenAI Chat Completions, Claude uses Anthropic Messages through the Agent SDK, and Codex app-server requires OpenAI Responses semantics. An endpoint can expose the same credential while supporting different model subsets on those protocols.

## Decision

Every conversation selects exactly one runtime in `SessionHeader.agentRuntime`: absent means the native DSH loop, `claude` means the Claude Agent SDK driver, and `codex` means the official Codex app-server driver. The header is immutable for that conversation and is persisted by JSONL and SQLite. Choosing another mode opens or reuses a blank conversation for the same Workspace instead of changing the live driver's history in place. Forks inherit the source runtime.

All three runtimes remain DSH agents. They receive the same durable Session, cwd, global permission events, credential references, assembled system prompt, runtime context projections, `agent/pre-step`, and `agent/request` model-selection waterfall. Each alternative driver records the effective provider, model, system prompt, and context in the Session before invoking its SDK. Credentials are resolved for each turn and enter only the scrubbed child environment. Claude ignores user and project Claude settings for its embedded query, while Codex receives an explicit Responses provider configuration. Their subprocess trees are owned and awaited by `dsh-subprocess`.

`Agent.modelConstraint` describes the provider and model ids that an alternative runtime can actually send. The session model catalog is filtered by that constraint, an incompatible global default resolves to the runtime's configured default, and an incompatible selection is rejected before process startup. This is protocol capability routing, not a claim that similarly named models are interchangeable. The current DashScope composition admits Kimi K3, Qwen 3.8 Max, and DeepSeek V4 Flash in native mode; its Anthropic Messages and Responses endpoints admit Qwen 3.8 Max and DeepSeek V4 Flash for Claude and Codex.

Claude and Codex keep their own built-in tool runtimes while DSH owns the permission decision and durable audit events. Command and file-change requests bridge to DSH approval and fail closed when no approver is available. The current text bridges reject images and other non-text content explicitly instead of dropping it.

## Consequences

- The runtime selector has three independent choices, and its label always comes from the current conversation header.
- Restart, list, recovery, and fork preserve the runtime identity; an unknown runtime fails session creation or recovery loudly.
- Global AI configuration and context are shared at the Host seam, while provider-specific execution, continuation ids, tools, and streaming remain owned by each driver.
- A global model selection cannot advertise success and then be ignored by Claude or Codex. Unsupported protocol/model combinations are hidden or rejected.
- Kimi K3 is currently a native-mode model in the shipped DashScope composition. Adding it to Claude or Codex later requires evidence that the corresponding Anthropic Messages or Responses endpoint supports it.
- Codex app-server user-input requests and usage accounting remain explicit deferred work. Claude and Codex do not yet receive DSH tool schemas as provider-native tools.

## Alternatives considered

Using the Codex TypeScript SDK was rejected for the primary desktop runtime because its basic thread API does not expose the complete approval, interruption, and item lifecycle needed by the Host. The official app-server protocol preserves those capabilities while keeping the durable Session and permission owner in DSH.

Reusing the existing one-shot Codex subagent was rejected because it has no continuation, progress, approval, or streaming contract. Translating every model through one nominally OpenAI-compatible endpoint was rejected because the live DashScope protocols support different model sets. Changing a conversation's runtime in place was rejected because SDK thread ids, tool history, approval state, and replay semantics belong to the driver that created that history.
