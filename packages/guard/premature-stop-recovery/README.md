# @voyaseek-ai/dsh-premature-stop-recovery

English | [中文](README.zh.md)

This guard recovers a narrow false-completion class: the default agent loop receives a provider `stop`, the final assistant message contains no tool call, and its visible Chinese or English tail unconditionally promises an immediate action such as starting a search, download, check, edit, or command. At `agent/turn-stopping`, the guard adds a plugin-sourced steering message so the action runs in another Step of the same Turn.

Normal result statements, conditional offers, responses containing tool calls, provider errors, cancellation, and `max-tokens` endings remain terminal. The detector never decides whether the whole user task is semantically complete; complex objectives retain their own goal and verification policy.

## Config

```yaml
- id: premature-stop-recovery
  name: '@voyaseek-ai/dsh-premature-stop-recovery'
  config:
    maxContinuations: 3
```

`maxContinuations` defaults to `3` and must be a positive integer. It bounds consecutive matched responses that produce no intervening successful `tool/result`; failed results, including schema validation failures, do not reset the counter, so a long task keeps running only while tools make concrete progress. When the no-progress limit is reached, the guard admits one final reporting Step that must state that the task is incomplete, the last concrete result or blocker, and the exact recovery action. If that report also ends with an action commitment, the guard writes a warning and allows the Turn to close rather than looping indefinitely.

## Durable diagnosis

Every recovery prompt is appended as a `user/message` whose source is `{ kind: 'plugin', plugin: 'premature-stop-recovery', form: 'notice' }`. Its `summary` records either `Automatic continuation <n>/<limit>` or `Recovery limit reached (<limit>)`. The ordinary Session-log Export command therefore includes the original provider finish, the unfinished assistant text, each recovery decision, and the eventual `turn/end` in one JSONL artifact; the guard creates no second log or private transcript.

## Model Experience

### Action continuation

#### What the model sees

After a matching provider stop and while the configured continuation budget remains, the next same-Turn request contains this retained plugin-sourced message.

##### Continuation prompt

```markdown
Continue the unfinished task now. The previous response announced an immediate action but did not perform it. Take the next concrete action with the available tools. Do not narrate, plan, or promise another action without executing it. Continue toward the requested deliverable until it is complete. If the task is actually complete or cannot safely continue, state the result or blocker explicitly instead.
```

#### Token effect

Zero tokens when no stop matches. Each recovery adds the fixed prompt once to retained Session history.

#### KV Cache effect

Append-only; the recovery message follows the reusable request prefix.

### Recovery-limit report

#### What the model sees

After `maxContinuations` consecutive matching responses without a tool result in one Turn, one final same-Turn request contains this retained plugin-sourced message.

##### Limit prompt

```markdown
Automatic continuation made no concrete progress after repeated attempts. Do not promise another action in this step. Tell the user plainly that the task remains incomplete, name the last concrete result or blocker, and state the exact next action needed to resume.
```

#### Token effect

The fixed prompt is added once only when one Turn exhausts its continuation budget.

#### KV Cache effect

Append-only; the limit message follows the reusable request prefix.

## Known Limitations and Deferred Work

- **Textual detection** — the bounded Chinese and English commitment forms can miss another phrasing or language; broad semantic completion judgment belongs to an explicit goal verifier rather than this guard.
- **Default-loop evidence only** — an alternative Agent driver that does not log the standard `assistant/chunk` provider finish is left unchanged.
