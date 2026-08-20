# Agent Note: cross-session memory is a local provider seam

Status: implemented

English | [中文](2026-08-19-bounded-cross-session-agent-memory.zh.md)

## Problem

Durable session logs and compaction restore one conversation but do not carry user facts into an independent session. The employee agent needs automatic recall that remains inspectable, removable, disabled by the user, and independent from the agent loop.

TencentDB Agent Memory provides a richer L0–L3 pipeline, asynchronous extraction, and hybrid retrieval, but its reviewed v3 gateway does not provide a safe default for this deployment. Authentication and strict isolation are optional, request bodies select identity scope, deletion lacks complete owner enforcement, and conversation capture has no idempotency key while the gateway generates message identifiers. Retrying an ambiguous write can duplicate memory.

## Decision

`ctx.agentMemory` is a provider-neutral capability with capture, maintenance, explicit remember, recall, list, forget, and clear operations. The shipped Provider stores controls in Settings and structured data in owner-only SQLite. A completed turn first passes a credential/secret detector, then enters a durable outbox under deterministic `(session id, turn)` identity. A crash therefore leaves recoverable work instead of losing the capture or making a retry duplicate it.

The Consumer listens to completed `turn/end` events and captures only direct user text plus the final Assistant message; tool, reasoning, stream chunk, system, and recalled plugin messages are excluded. It uses the conversation's existing routed model through `ctx.llm` to propose upsert, delete, or no-op mutations against relevant candidates. The user text is the only authority; Assistant output only disambiguates it. The Provider validates every mutation and updates the unique `workspace + kind + semantic key`, so corrections replace prior values. Events expire after a configured TTL and failed extractions remain in the outbox for bounded retry.

On the first step of a later session, `agent/pre-step` recalls relevant items, marks them as untrusted history, and appends one `agent-memory`-sourced `user/message` carrying exact item identities. The existing loop logs that message before the model request, preserving the model-visible-means-logged invariant without changing `agent-loop` or the session format. `memory_search`, `memory_remember`, and `memory_forget` give the Agent an explicit correction path without adding another skill or runtime.

The memory management page registers through the stable `settings.section` slot. Configuration continues through revision-guarded `settings.*`; entries use dedicated `memory.list`, `memory.update`, `memory.forget`, and `memory.clear` methods, all pinned to loopback. The browser receives no database path. Disabling pauses capture and recall without deleting entries; item deletion and clear-all require explicit confirmation.

Automatic maintenance appends `agent-memory/maintenance` only after the provider transaction commits. The conversation plugin projects it as a low-emphasis status row and projects recalled `agent-memory` messages as low-emphasis context rows. Both carry exact item identities into the same editor, so users can inspect what was stored or recalled and replace incorrect content without leaving the conversation. The editor is contributed through a child slot rather than coupled into the generic conversation package.

TencentDB Agent Memory is recorded as an architecture reference, not a runtime dependency or proxy. A remote provider remains replaceable behind `ctx.agentMemory` after the service enforces authentication, trusted identity binding, strict isolation, owner-checked deletion, and idempotent capture.

## Consequences

- Cross-session memory works by default with no external service, credential, vector database, Python runtime, or second Agent runtime.
- The default capacity is 2,000 structured items rather than 200 raw turns. It is a product resource budget, not a SQLite limit; `maxEntries` remains deployment-configurable.
- Lexical/keyword retrieval deliberately avoids a second embedding seam. Automatic pre-step recall guarantees daily use for relevant prompts, while explicit tools handle user-requested search, correction, and deletion.
- The local Provider remains single-user and project scope follows trusted Session cwd. Shared Hosts require an authenticated identity-scoped Provider; moving a project currently forms a new local scope.
- Recall failure degrades to the current turn. Capture survives a process restart in the outbox; permanently failed maintenance is visible in Settings and does not change the completed session result.
- A visible “updated” row means the provider transaction committed and the result was appended to the session log; queued work is never presented as saved.

## Alternatives considered

Reusing session full-text search was rejected because it indexes conversation history but does not own structured replacement, forgetting, expiry, or a user-managed lifecycle. The existing MCP examples remain opt-in tool integrations and do not guarantee automatic recall before the model step. Tencent's MemoryProxy was rejected because changing the model base URL to a heuristic MITM proxy couples memory to transport and weakens identity control. Mem0, LangMem, Graphiti, and Letta Code are recorded as architecture inputs for mutation decisions, background maintenance, validity, and explicit tools respectively; direct dependencies would duplicate the existing LLM, Agent, storage, or language runtime.
