# @voyaseek-ai/dsh-agent-memory-settings

English | [中文](README.zh.md)

Default local provider. Settings owns live controls only; structured items and the extraction outbox live in an owner-only SQLite database at `$VOYASEEK_HOME/memory/agent-memory.sqlite`.

| Config | Default | Meaning |
| --- | ---: | --- |
| `enabled` | `false` | Enables capture and recall only after the user opts in; disabling keeps existing entries. |
| `autoCapture` / `autoRecall` | `true` | Controls completed-turn writes and later-session reads. |
| `maxEntries` | `2000` | Evicts the least recently updated structured items beyond the local product budget. |
| `maxHits` | `5` | Bounds one recall result. |
| `maxContentChars` / `maxTitleChars` | `2000` / `120` | Bounds each persisted item by Unicode code points. |
| `eventTtlDays` | `30` | Expires time-sensitive event memories. |
| `maintenanceBatchSize` / `maintenanceMaxAttempts` | `4` / `5` | Bounds one background pass and failed extraction retries. |

Before any durable write or extraction call, the provider rejects turns that resemble credentials, bearer tokens, private keys, or secret assignments. Only direct user text enters the idempotent `(session id, turn)` outbox; Assistant messages, tool output, reasoning, system text, and recalled history never enter extraction. Every automatic upsert or delete must carry an exact supporting quote contained in that captured user text, which the provider verifies before its transaction writes anything. The explicit `memory_remember` tool applies the same quote requirement to the current user message. Successful maintenance updates one row per `workspace + kind + semantic key`, so a correction replaces the old value instead of accumulating raw dialogue. Recall combines extractor keywords, Chinese bigrams, ASCII terms, confidence, and update recency. The Settings document contains only controls; opening it never exposes or edits the SQLite file.

The provider upgrades supported older schemas through ordered migrations inside one SQLite transaction. Schema v2 upgrades to v3 without losing committed memories or pending user text; the migration removes the obsolete Assistant-output field from pending captures. A failed step rolls back the whole upgrade and leaves the old database untouched. Versions without a complete migration path, including v1, are rejected before serving data. With every Host stopped, `pnpm run memory:reset -- --backup [--home <directory>]` moves an unsupported database to an owner-only timestamped backup; `--delete` permanently unlinks it. The command accepts only the agent-memory application id and an unsupported schema, refuses links and WAL/SHM sidecars, and never changes session logs or Settings. The next Host start creates an empty current-schema database.

## Model Experience

Indirectly, through the agent-memory context consumer that renders stored results as a logged recall message.

#### KV Cache effect

Storage alone adds no content; a recalled message changes the request suffix through the consumer.

## Known Limitations and Deferred Work

- Retrieval is lexical and keyword-based rather than embedding/vector search; automatic recall plus explicit tools cover the default desktop workflow without another indexing runtime.
- Project scope currently follows the trusted Session cwd. Moving a project creates a new local scope.
- A shared or remote multi-user Host must use an authenticated identity-scoped provider.
- Seamless upgrade requires one reviewed, transactional migration step for every intervening schema version. A database with a missing step remains unchanged and requires backup or explicit reset.
