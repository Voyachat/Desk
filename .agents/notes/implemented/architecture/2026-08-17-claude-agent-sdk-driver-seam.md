# Agent Note: Agent driver seam lets the Claude Agent SDK orchestrate DSH sessions

Status: implemented

## Problem

DSH sessions are orchestrated exclusively by the in-repo ReactLoopAgent:
`AgentLoop` hardcodes it in `prepare()`. Running a session under the Claude
Agent SDK — Claude Code as the programming orchestrator, with any
Claude-API-compatible gateway supplying the endpoint — had no seam that kept
the session log, inbox, turn/step boundaries, approval flow, and
create/resume lifecycle intact. Forking the loop would duplicate its
lifecycle machinery and drift; intercepting `llm/stream` would forge turn
structure the SDK owns.

## Decision

One documented extension point in `agent-loop`: a driver-factory registry
keyed by session runtime. `AgentLoop.registerDriverFactory(factory)` accepts
an `AgentDriverFactory` (`runtime` + `createDriver`); `constructDriver`
consults `session.header.agentRuntime` at create/resume — absent keeps
ReactLoopAgent, a named runtime without a registered driver fails loud. The
driver implements the ordinary `Agent` interface plus a scope, so
publication, disposal, and HMR behavior stay the loop's.

`packages/claude/claude-agent` registers the `claude` runtime and keeps the
integration decoupled: the official SDK pins independently, the package group
can move to its own repository, and the only in-repo touchpoints are the
seam, the `SessionHeader.agentRuntime` field (mirrors `agentPreset`), and the
`claude-agent/runtime` session event (in the generated persistence catalog).
Per turn the driver runs one SDK `query()` under the session cwd, folds SDK
messages onto durable events (`assistant/message`, `tool/call`,
`tool/result` linked by `sourceEventSeqs`), records the SDK conversation id
from `system/init` for multi-turn `resume` (restored from the log after
restart), spawns the CLI through `dsh-subprocess` with a scrubbed parent env,
and bridges tool approval through `canUseTool` (fail-closed) unless
`permissionMode: 'bypassPermissions'`.

The gateway threads the choice end to end: `session.create` validates
`agentRuntime` against `driverRuntimes()` (`runtime-not-found`), records it
on the header, echoes it, serves it in summaries and the `session-added`
frame, refuses a differing cold resume (`runtime-conflict`), and forks
inherit it because their seed was produced under it. The browser half
(`packages/claude/ui-runtime`) occupies the composer `conversation.input.left`
seat: it labels the current session runtime and switches by connecting the
owning workspace under the chosen runtime — a session never changes its own
runtime, so the switch lands on a session minted under the pick.

## Consequences

- Runtime is fixed at session creation, exactly like `agentPreset`; resume
  and fork never re-select it.
- Claude turns log final messages, not token streams: v1 folds whole SDK
  messages, and the UI renders them message-wise.
- DSH tools, subagents, and projections do not run inside claude turns;
  Claude Code's built-in surface orchestrates.
- The deployment composes the driver where it wants it: the Aistaff product
  bundle carries the host row, the web-app roster carries the chip; base
  deployments see neither.
