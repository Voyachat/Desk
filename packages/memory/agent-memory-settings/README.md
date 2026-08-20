# @voyaseek-ai/dsh-agent-memory-settings

English | [中文](README.zh.md)

Default local provider. Settings owns live controls only; structured items and the extraction outbox live in an owner-only SQLite database at `$VOYASEEK_HOME/memory/agent-memory.sqlite`.

| Config | Default | Meaning |
| --- | ---: | --- |
| `enabled` | `true` | Enables both automatic paths without deleting entries when disabled. |
| `autoCapture` / `autoRecall` | `true` | Controls completed-turn writes and later-session reads. |
| `maxEntries` | `2000` | Evicts the least recently updated structured items beyond the local product budget. |
| `maxHits` | `5` | Bounds one recall result. |
| `maxContentChars` / `maxTitleChars` | `2000` / `120` | Bounds each persisted item by Unicode code points. |
| `eventTtlDays` | `30` | Expires time-sensitive event memories. |
| `maintenanceBatchSize` / `maintenanceMaxAttempts` | `4` / `5` | Bounds one background pass and failed extraction retries. |

Before any durable write or extraction call, the provider rejects turns that resemble credentials, bearer tokens, private keys, or secret assignments. Accepted turns enter an idempotent `(session id, turn)` outbox. Successful maintenance updates one row per `workspace + kind + semantic key`, so a correction replaces the old value instead of accumulating raw dialogue. Recall combines extractor keywords, Chinese bigrams, ASCII terms, confidence, and update recency. The Settings document contains only controls; opening it never exposes or edits the SQLite file.

## Model Experience

Indirectly, through the agent-memory context consumer that renders stored results as a logged recall message.

#### KV Cache effect

Storage alone adds no content; a recalled message changes the request suffix through the consumer.

## Known Limitations and Deferred Work

- Retrieval is lexical and keyword-based rather than embedding/vector search; automatic recall plus explicit tools cover the default desktop workflow without another indexing runtime.
- Project scope currently follows the trusted Session cwd. Moving a project creates a new local scope.
- A shared or remote multi-user Host must use an authenticated identity-scoped provider.
