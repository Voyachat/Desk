# Agent Note: cross-session memory is a local provider seam

Status: implemented

English | [中文](2026-08-19-bounded-cross-session-agent-memory.zh.md)

## Problem

Durable session logs and compaction restore one conversation but do not carry user facts into an independent session. The employee agent needs automatic recall that remains inspectable, removable, disabled by the user, and independent from the agent loop.

TencentDB Agent Memory provides a richer L0–L3 pipeline, asynchronous extraction, and hybrid retrieval, but its reviewed v3 gateway does not provide a safe default for this deployment. Authentication and strict isolation are optional, request bodies select identity scope, deletion lacks complete owner enforcement, and conversation capture has no idempotency key while the gateway generates message identifiers. Retrying an ambiguous write can duplicate memory.

## Decision

`ctx.agentMemory` is a provider-neutral capability with capture, recall, list, forget, and clear operations. The shipped provider keeps at most 200 bounded conversation items in the existing user settings document. A deterministic `(session id, turn)` identity makes local capture idempotent, and serialized settings mutations preserve existing Settings concurrency and revision behavior.

The consumer listens to completed `turn/end` events and captures only direct user text plus the final assistant message; tool, reasoning, stream chunk, system, and recalled plugin messages are excluded. On the first step of a later session, `agent/pre-step` recalls same-project items, marks them as untrusted history, and appends one plugin-sourced `user/message`. The existing loop logs that message before the model request, preserving the model-visible-means-logged invariant without changing `agent-loop` or the session format.

The memory management page registers through the stable `settings.section` slot and uses the loopback-only, revision-guarded Settings RPC. It therefore follows either modal or full-frame Settings shells without importing their presentation state. Disabling pauses capture and recall without deleting entries; item deletion and clear-all require explicit confirmation.

TencentDB Agent Memory is recorded as an architecture reference, not a runtime dependency or proxy. A remote provider remains replaceable behind `ctx.agentMemory` after the service enforces authentication, trusted identity binding, strict isolation, owner-checked deletion, and idempotent capture.

## Consequences

- Cross-session memory works by default with no service, credential, vector database, or second agent runtime.
- The local file is user-visible and bounded, but lexical retrieval, whole-document writes, and home-wide identity restrict it to one user's desktop. Shared Hosts require an identity-scoped provider.
- A SQLite or hardened remote provider can replace storage without changing automatic capture or recall. A provider that does not own the local Settings namespace must also supply a privileged management adapter for its data lifecycle.
- Recall failure degrades to the current turn, while capture failure is logged and never changes the completed session result.

## Alternatives considered

Reusing session full-text search was rejected because it indexes conversation history but does not own memory deletion, forgetting, or a bounded user-managed lifecycle. The existing MCP examples remain opt-in tool integrations and do not guarantee automatic recall before the model step. Tencent's MemoryProxy was rejected because changing the model base URL to a heuristic MITM proxy couples memory to transport and weakens identity control.
