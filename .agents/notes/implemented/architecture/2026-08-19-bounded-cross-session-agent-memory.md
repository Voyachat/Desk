# Agent Note: cross-session memory is a local provider seam

Status: implemented

English | [中文](2026-08-19-bounded-cross-session-agent-memory.zh.md)

## Problem

Durable session logs and compaction restore one conversation but do not carry user facts into an independent session. The employee agent needs automatic recall that remains inspectable, removable, disabled by the user, and independent from the agent loop.

TencentDB Agent Memory provides a richer L0–L3 pipeline, asynchronous extraction, and hybrid retrieval, but its reviewed v3 gateway does not provide a safe default for this deployment. Authentication and strict isolation are optional, request bodies select identity scope, deletion lacks complete owner enforcement, and conversation capture has no idempotency key while the gateway generates message identifiers. Retrying an ambiguous write can duplicate memory.

## Decision

`ctx.agentMemory` is a provider-neutral capability with capture, maintenance, explicit remember, recall, list, forget, and clear operations. The shipped Provider stores controls in Settings and structured data in owner-only SQLite. A completed turn first passes a credential/secret detector, then enters a durable outbox under deterministic `(session id, turn)` identity. A crash therefore leaves recoverable work instead of losing the capture or making a retry duplicate it.

The Consumer listens to completed `turn/end` events and captures only direct user text; Assistant messages, tool output, reasoning, stream chunks, system text, and recalled history are excluded. It uses the conversation's existing routed model through `ctx.llm` to propose upsert, delete, or no-op mutations against relevant candidates. Every automatic mutation must carry an exact supporting quote contained in the captured user text, and the Provider rejects the complete transaction when that evidence is absent. The explicit `memory_remember` tool applies the same quote requirement to the current direct user message. The Provider updates the unique `workspace + kind + semantic key`, so corrections replace prior values. Events expire after a configured TTL and failed extractions remain in the outbox for bounded retry.

On the first step of a later session, `agent/pre-step` recalls relevant items, marks them as untrusted history, and appends one `agent-memory`-sourced `user/message` carrying exact item identities. The existing loop logs that message before the model request, preserving the model-visible-means-logged invariant without changing `agent-loop` or the session format. `memory_search`, `memory_remember`, and `memory_forget` give the Agent an explicit correction path without adding another skill or runtime.

The memory management page registers through the stable `settings.section` slot. Configuration continues through revision-guarded `settings.*`; entries use dedicated `memory.list`, `memory.update`, `memory.forget`, and `memory.clear` methods, all pinned to loopback. The browser receives no database path. Memory is disabled by default. While disabled, no completed turn is queued, recall is skipped, and memory guidance plus tool schemas are absent from model assembly. The user-facing switch enables or pauses those paths without deleting entries; item deletion and clear-all require explicit confirmation.

Automatic maintenance appends `agent-memory/maintenance` only after the provider transaction commits. The conversation plugin projects it as a low-emphasis status row and projects recalled `agent-memory` messages as low-emphasis context rows. Both carry exact item identities into the same editor, so users can inspect what was stored or recalled and replace incorrect content without leaving the conversation. The editor is contributed through a child slot rather than coupled into the generic conversation package.

The SQLite format uses a monotonic schema version and an ordered migration step for every supported prior version. All steps run in one `BEGIN IMMEDIATE` transaction; success advances `user_version`, while any failure rolls back the complete upgrade and leaves the old database untouched. The current v2-to-v3 migration preserves committed memories and pending direct-user captures while removing the obsolete Assistant-output field. Versions without a complete path, including v1, fail before serving data. Offline recovery accepts only the agent-memory application id and an unsupported schema, refuses links or live WAL state, then either moves the database to a private timestamped backup or permanently unlinks it according to the operator's selected mode. A later Host start creates an empty current database.

TencentDB Agent Memory is recorded as an architecture reference, not a runtime dependency or proxy. A remote provider remains replaceable behind `ctx.agentMemory` after the service enforces authentication, trusted identity binding, strict isolation, owner-checked deletion, and idempotent capture.

## Consequences

- Cross-session memory requires an explicit user opt-in and needs no external service, credential, vector database, Python runtime, or second Agent runtime after it is enabled.
- The default capacity is 2,000 structured items rather than 200 raw turns. It is a product resource budget, not a SQLite limit; `maxEntries` remains deployment-configurable.
- Lexical/keyword retrieval deliberately avoids a second embedding seam. Automatic pre-step recall guarantees daily use for relevant prompts, while explicit tools handle user-requested search, correction, and deletion.
- The local Provider remains single-user and project scope follows trusted Session cwd. Shared Hosts require an authenticated identity-scoped Provider; moving a project currently forms a new local scope.
- Recall failure degrades to the current turn. Capture survives a process restart in the outbox; permanently failed maintenance is visible in Settings and does not change the completed session result.
- A visible “updated” row means the provider transaction committed and the result was appended to the session log; queued work is never presented as saved.
- A supported prior schema upgrades without losing memory; a missing migration step blocks provider startup until the operator explicitly backs up or deletes that memory database. Session logs and Settings remain independent.

## Alternatives considered

Reusing session full-text search was rejected because it indexes conversation history but does not own structured replacement, forgetting, expiry, or a user-managed lifecycle. The existing MCP examples remain opt-in tool integrations and do not guarantee automatic recall before the model step. Tencent's MemoryProxy was rejected because changing the model base URL to a heuristic MITM proxy couples memory to transport and weakens identity control. Mem0, LangMem, Graphiti, and Letta Code are recorded as architecture inputs for mutation decisions, background maintenance, validity, and explicit tools respectively; direct dependencies would duplicate the existing LLM, Agent, storage, or language runtime.
