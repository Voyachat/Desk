# @voyaseek-ai/dsh-agent-memory

English | [中文](README.zh.md)

Provider-neutral `ctx.agentMemory` service definition for bounded cross-session capture, recall, listing, deletion, and clearing.

Consumers pass scope derived from a trusted Session. Providers return ordered items without imposing a cross-provider numeric score, and `MemoryId` remains opaque outside the provider. `capture()` is idempotent for a session turn; `forget()` and `clear()` report how many items were deleted.

Cancellation is optional and travels beside the request so stored data never contains process-local signals. The service does not expose Tencent L0–L3 names, storage paths, credentials, or tenant identity.

## Model Experience

Indirectly, through the agent-memory context consumer that renders provider results as a logged recall message.

#### KV Cache effect

The service definition adds no content; consumers own any cache effect.

## Known Limitations and Deferred Work

- Providers must derive scope from trusted Session and Host identity rather than model or browser fields.
- Automatic retry requires the selected provider to honor capture idempotency.
