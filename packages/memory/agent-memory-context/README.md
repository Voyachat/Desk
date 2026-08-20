# @voyaseek-ai/dsh-agent-memory-context

English | [中文](README.zh.md)

Queues completed human/assistant turns, extracts structured memories through the existing `ctx.llm`, injects bounded prior-session recall through `agent/pre-step`, and registers `memory_search`, `memory_remember`, and `memory_forget`.

The consumer listens only to completed `turn/end` events. Direct user text is authoritative; the final Assistant message is context only, while system, tool, reasoning, streaming, and plugin recall content is excluded. The model emits at most eight validated mutations against provider-supplied candidates. Maintenance is scoped to the originating live session, including its next resume after a crash, so the provider transaction commits before the consumer appends `agent-memory/maintenance` with exact created, updated, and deleted identities. Failed calls remain in the durable provider outbox for bounded retry and never change the completed user-turn result.

## Model Experience

### Recalled history

#### What the model sees

On step one, relevant same-project memories from other sessions appear before the current direct user input with a warning that they are untrusted history and that the current request wins. The message source is `kind: agent-memory`, `form: recall` and carries exact item identities for the management UI; AgentLoop persists it before the model request.

#### Token effect

At most `maxRecallChars` Unicode code points join the first request. Later steps reuse the logged message until compaction.

#### KV Cache effect

Recall changes only the current session's request suffix; the system prompt and earlier stable prefix remain reusable.

## Known Limitations and Deferred Work

- Recall failure continues without memory; Settings exposes pending and permanently failed maintenance counts.
- Extraction quality follows the routed conversation model. Explicit tools let the user correct misses, but shared-host identity remains provider-owned.
