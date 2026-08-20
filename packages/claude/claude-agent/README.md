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
- assembles the same scoped system prompt and dynamic context as the native
  loop, runs `agent/pre-step` and `agent/request`, and records the exact
  provider/model/system snapshot in `request/header` before each SDK query;
- runs one SDK `query()` per turn under the session cwd, mapping SDK messages
  onto durable session events: `system/init` records a `claude-agent/runtime`
  event (the SDK conversation id plus the model), assistant text/thinking/tool
  blocks fold into `assistant/message` and `tool/call`, and SDK tool results
  fold into `tool/result` linked to their call by `sourceEventSeqs`;
- resumes the SDK conversation across turns by passing the recorded SDK
  session id as `resume`, restoring it from the log after a restart;
- after a cross-runtime fork, ignores Claude session ids before the latest
  `agent/runtime/switched` marker and starts a new SDK conversation with a
  provider-neutral recall of the retained visible transcript;
- spawns the Claude Code CLI through `dsh-subprocess` with a scrubbed parent
  environment, so the SDK child inherits exactly the intended `ANTHROPIC_*`
  endpoint and credentials.

Any Claude-API-compatible endpoint works: `baseUrl`/`authToken`/`apiKey`/
`model` map onto `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` /
`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, and unset fields fall through to the
parent environment, so third-party gateways need only their env vars.

Registered LLM routes whose exact model descriptor uses `anthropic-messages`, has an endpoint, and names a credential reference join the Claude model picker automatically. The driver resolves that route's current endpoint and credential for each query. OpenAI Responses and Chat Completions routes are not presented as Claude-compatible, even when the same account key can authenticate them.

The SDK `canUseTool` hook carries two different interactions. `AskUserQuestion` delegates to the host question service and returns its answers to Claude; it never opens an approval panel. Other permission requests delegate to the host approval service and fail closed when that service is absent.

Without an explicit `permissionMode`, each query reads the latest session permission events. `read-only` uses SDK `default`; `workspace-write` plus `ask` uses classifier-backed `auto`; `danger-full-access` plus `never` keeps SDK `default` so questions remain interactive, while the bridge directly allows every non-question tool. An explicit `permissionMode` remains a deployment-wide override. Explicit `bypassPermissions` is accepted for deployments that need the raw SDK posture, but the SDK resolves tools before `canUseTool` in that mode and therefore cannot deliver `AskUserQuestion` to the host.

The approval panel offers a remembered action only when Claude's entire suggestion batch consists of same-tool `addRules` updates with `behavior: allow` and `destination: session`. Accepted rules are passed to the next SDK query child in the same live driver. Mixed updates, settings-file destinations, mode changes, directory grants, deny rules, and cross-tool rules remain one-shot; DSH never writes Claude user, project, or local settings from the generic approval panel. These remembered rules do not survive an application or driver restart.

## Config

| key | default | meaning |
| --- | --- | --- |
| `runtime` | `claude` | session-header runtime this factory serves |
| `provider` | `claude-agent` | global model-provider route served by this Anthropic-compatible endpoint |
| `model` | absent | `ANTHROPIC_MODEL` overlay for the SDK child |
| `models` | absent | exact model ids admitted by this endpoint; also filters the session model picker |
| `baseUrl` | absent | `ANTHROPIC_BASE_URL` overlay (compat gateways) |
| `authToken` | absent | `ANTHROPIC_AUTH_TOKEN` overlay |
| `apiKey` | absent | `ANTHROPIC_API_KEY` overlay |
| `apiKeyEnv` | absent | credential reference resolved per query and exposed as `ANTHROPIC_API_KEY` |
| `permissionMode` | session permission state | explicit SDK permission mode (`default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions`) |
| `executable` | SDK-resolved | explicit `claude` CLI path (`pathToClaudeCodeExecutable`) |
| `env` | `{}` | extra child-env entries layered over the scrubbed parent env |
| `disposeGraceMs` | `3000` | grace period before a cancelled SDK child is terminated |

## Model Experience

### Claude SDK query

#### What the model sees

The assembled DSH system prompt is the SDK custom system prompt. Logged dynamic-context snapshots and user text pass through `agent/pre-step`; the global provider/model selection passes through `agent/request` and becomes the exact query model. On the first turn after a cross-runtime fork, a user-level `recall` message carries retained user, assistant, and tool transcript text; it omits private reasoning and stale plugin context, and represents earlier images with a placeholder. Claude Code owns its built-in tools, so DSH tool schemas are not presented as Claude tools. This text bridge rejects images and every other non-text block in the new turn before the query.

#### Token effect

The custom system prompt, retained context snapshots, user input, cross-runtime recall when present, and Claude-owned tool transcript consume the SDK conversation context. DSH records no Claude token counts in this version.

#### KV Cache effect

Claude owns the conversation cache under `~/.claude`; DSH preserves its SDK session id across ordinary turns. A cross-runtime fork intentionally starts a new SDK conversation and therefore cannot reuse the source provider conversation cache; changing the selected model or assembled system prompt can also invalidate cache reuse.

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
