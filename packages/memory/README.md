# Memory

English | [中文](README.zh.md)

Cross-session memory capability family. `agent-memory` owns the provider-neutral service, `agent-memory-settings` is the Settings-configured SQLite Provider, and `agent-memory-context` owns automatic extraction, recall, and explicit tools through existing Agent extension points.

| Package | Role | `ctx` key |
| --- | --- | --- |
| `agent-memory` | Service Definition | `agentMemory` |
| `agent-memory-settings` | Service Provider | `agentMemory` |
| `agent-memory-context` | Consumer | — |

## Known Limitations and Deferred Work

The default Provider stores structured items and a recoverable extraction outbox in owner-only SQLite while Settings contains controls only. It remains valid only for one user's desktop home; a shared or remote Host must replace it with an authenticated identity-scoped Provider. TencentDB Agent Memory remains opt-in until authentication, strict isolation, owner-checked deletion, and capture idempotency are enforced server-side.
