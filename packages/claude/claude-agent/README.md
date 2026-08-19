# @voyaseek-ai/dsh-claude-agent

English | [中文](README.zh.md)

Claude Agent SDK driver for DSH sessions: a session created under the
`claude` runtime is orchestrated by Claude Code (through the official
`@anthropic-ai/claude-agent-sdk`) instead of the default DSH ReactLoopAgent.
The package is the host half of the Claude integration; the browser half is
`@voyaseek-ai/dsh-claude-runtime-ui` (the composer runtime selector).

## How it works

`agent-loop` exposes a driver-factory registry keyed by session runtime. This
package registers a factory for the `claude` runtime; `AgentLoop` consults
`session.header.agentRuntime` at create/resume and builds a `ClaudeSdkAgent`
for claude sessions. The driver:

- owns the turn/step boundaries and the inbox exactly like the default loop,
  so the session log stays the source of truth;
- runs one SDK `query()` per turn under the session cwd, mapping SDK messages
  onto durable session events: `system/init` records a `claude-agent/runtime`
  event (the SDK conversation id plus the model), assistant text/thinking/tool
  blocks fold into `assistant/message` and `tool/call`, and SDK tool results
  fold into `tool/result` linked to their call by `sourceEventSeqs`;
- resumes the SDK conversation across turns by passing the recorded SDK
  session id as `resume`, restoring it from the log after a restart;
- spawns the Claude Code CLI through `dsh-subprocess` with a scrubbed parent
  environment, so the SDK child inherits exactly the intended `ANTHROPIC_*`
  endpoint and credentials.

Any Claude-API-compatible endpoint works: `baseUrl`/`authToken`/`apiKey`/
`model` map onto `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, and unset fields fall through to the
parent environment, so third-party gateways need only their env vars.

Tool approval bridges to the host approval service through the SDK
`canUseTool` hook (fail-closed when no approval service is present). Without
an explicit `permissionMode`, each query reads the latest session permission
events: `read-only` uses SDK `default`, `workspace-write` plus approval policy
`ask` uses `acceptEdits`, and `danger-full-access` plus `never` uses
`bypassPermissions`. Non-bypass modes keep the approval bridge. An explicit
`permissionMode` remains a deployment-wide override. When Claude supplies an exact permission-update
suggestion, the approval panel offers allow once, allow and remember, and
reject. The remembered result returns Claude's complete suggestion set to the
SDK unchanged; DSH never derives a broader rule from the tool name or path.

## Config

| key | default | meaning |
| --- | --- | --- |
| `runtime` | `claude` | session-header runtime this factory serves |
| `model` | absent | `ANTHROPIC_MODEL` overlay for the SDK child |
| `baseUrl` | absent | `ANTHROPIC_BASE_URL` overlay (compat gateways) |
| `authToken` | absent | `ANTHROPIC_AUTH_TOKEN` overlay |
| `apiKey` | absent | `ANTHROPIC_API_KEY` overlay |
| `permissionMode` | session permission state | explicit SDK permission mode (`default`, `acceptEdits`, `plan`, `bypassPermissions`) |
| `executable` | SDK-resolved | explicit `claude` CLI path (`pathToClaudeCodeExecutable`) |
| `env` | `{}` | extra child-env entries layered over the scrubbed parent env |
| `disposeGraceMs` | `3000` | grace period before a cancelled SDK child is terminated |

## Model Experience

- **Prompt**: the user's prompt text for the turn goes to Claude Code
  verbatim; the DSH system prompt and DSH tool schemas do not participate —
  Claude Code applies its own prompt and built-in tools.
- **Tokens**: usage accounting is the SDK's; DSH records no token counts for
  claude turns in v1.
- **KV cache**: DSH never builds model requests for this driver; the SDK owns
  its own conversation cache under `~/.claude`.

## Known Limitations and Deferred Work

- No `assistant/chunk` streaming: the transcript folds final SDK messages,
  so the UI renders claude replies message-wise rather than token-wise.
- DSH tools, subagents, and projections do not participate in claude turns;
  orchestration is entirely Claude Code's built-in surface.
- The `claude-agent/runtime` session event is in-repo: persistence loads
  recognize it through the generated catalog, but if this package moves out
  of the repo, older logs carrying the event need the package mounted (the
  append API gains plugin-ignorable events when a second consumer exists).
- Token/usage statistics and per-turn cost reporting are deferred.
- Claude permission modes and the native DSH file sandbox share product-level intent but not an operating-system enforcement implementation; UI copy must not claim identical kernel isolation or network control.
