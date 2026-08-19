# @voyaseek-ai/dsh-agent-memory-settings

English | [中文](README.zh.md)

Default local provider. It keeps a bounded item map in the existing user-editable settings document and serializes capture, recall, deletion, and clear operations.

| Config | Default | Meaning |
| --- | ---: | --- |
| `enabled` | `true` | Enables both automatic paths without deleting entries when disabled. |
| `autoCapture` / `autoRecall` | `true` | Controls completed-turn writes and later-session reads. |
| `maxEntries` | `200` | Evicts the oldest entries before adding beyond the limit. |
| `maxHits` | `5` | Bounds one recall result. |
| `maxContentChars` / `maxTitleChars` | `4000` / `120` | Bounds each persisted item by Unicode code points. |

The provider uses `(session id, turn)` for deterministic capture identity, exact workspace matching for project-scoped entries, Chinese bigrams and ASCII words for lexical ranking, and the existing Settings write queue for serialization. The data lives under `agent-memory` in `$VOYASEEK_HOME/settings.yaml`; opening the memory file therefore opens the shared user settings document.

## Model Experience

Indirectly, through the agent-memory context consumer that renders stored results as a logged recall message.

#### KV Cache effect

Storage alone adds no content; a recalled message changes the request suffix through the consumer.

## Known Limitations and Deferred Work

- Whole-document settings writes and lexical retrieval target a bounded single-user desktop store.
- A shared or remote multi-user Host must use an identity-scoped provider.
- Dedicated SQLite is the replacement for larger personal stores, while a hardened remote provider serves fleets; neither requires a consumer rewrite, but a provider that does not own the Settings namespace needs its own privileged management adapter.
