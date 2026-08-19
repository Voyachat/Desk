# Memory

English | [中文](README.zh.md)

Cross-session memory capability family. `agent-memory` owns the provider-neutral service, `agent-memory-settings` is the bounded default local provider, and `agent-memory-context` captures completed turns and injects recalled history through the existing agent extension points.

| Package | Role | `ctx` key |
| --- | --- | --- |
| `agent-memory` | Service Definition | `agentMemory` |
| `agent-memory-settings` | Service Provider | `agentMemory` |
| `agent-memory-context` | Consumer | — |

## Known Limitations and Deferred Work

The default provider intentionally bounds its data in the existing local settings document and is valid only for one user's desktop home. A shared or remote multi-user Host must replace it with an identity-scoped provider. A dedicated SQLite provider is the next storage step for larger personal stores; the public service keeps that replacement independent from Agent and UI consumers. TencentDB Agent Memory remains opt-in until authentication, strict isolation, owner-checked deletion, and capture idempotency are enforced server-side.
