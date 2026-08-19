# @voyaseek-ai/dsh-agent-memory-context

English | [中文](README.zh.md)

Captures completed human/assistant turns and injects bounded, source-attributed prior-session recall through `agent/pre-step`. Recalled text is explicitly treated as untrusted historical data.

The consumer listens only to completed `turn/end` events. It keeps direct user text and the final Assistant message while excluding system, tool, reasoning, streaming, and plugin recall content. `maxRecallChars` defaults to `6000` Unicode code points.

## Model Experience

### Recalled history

#### What the model sees

On step one, relevant same-project memories from other sessions appear before the current direct user input with a warning that they are untrusted history and that the current request wins. The message source is `plugin: agent-memory-context`, `form: recall`; AgentLoop persists it before the model request.

#### Token effect

At most `maxRecallChars` Unicode code points join the first request. Later steps reuse the logged message until compaction.

#### KV Cache effect

Recall changes only the current session's request suffix; the system prompt and earlier stable prefix remain reusable.

## Known Limitations and Deferred Work

- Recall failure continues without memory, and asynchronous capture failure only logs a warning.
- Ranking, extraction, identity scope, and forgetting policy remain provider-owned.
