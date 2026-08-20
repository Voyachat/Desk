# @voyaseek-ai/dsh-agent-memory

English | [中文](README.zh.md)

Provider-neutral `ctx.agentMemory` service definition for structured cross-session capture, background maintenance, explicit remembering, recall, listing, exact-item editing, deletion, and clearing.

Consumers pass scope derived from a trusted Session. `capture()` queues a completed turn under a deterministic identity; `maintain()` applies candidate-aware `upsert`/`delete`/`none` mutations and returns per-turn committed changes; `remember()` writes an explicit preference, fact, or constraint; `update()` replaces the user-editable fields of one exact `MemoryId`. Providers return ordered items without imposing a cross-provider numeric score, and `MemoryId` remains opaque outside the provider.

Cancellation is optional and travels beside the request so stored data never contains process-local signals. The service does not expose Tencent L0–L3 names, storage paths, credentials, or tenant identity.

## Model Experience

Indirectly, through the agent-memory context consumer that renders provider results as a logged recall message.

#### KV Cache effect

The service definition adds no content; consumers own any cache effect.

## Known Limitations and Deferred Work

- Providers must derive scope from trusted Session and Host identity rather than model or browser fields.
- Shared Hosts still require a provider that derives employee identity from authenticated Host context.
