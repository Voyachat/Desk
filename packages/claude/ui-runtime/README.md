# @voyaseek-ai/dsh-claude-runtime-ui

English | [中文](README.zh.md)

Composer runtime selector: labels the agent driver the current session runs
under — Native (the DSH loop), Claude (the Claude Agent SDK driver), or Codex
(the OpenAI Codex driver) — and switches between them.

The browser half occupies the `conversation.input.left` composer seat (right
of the resident chrome, beside the plan chip). The node half is an empty
apply that exists only so the plugin appears in the host composition; the
surface ships through `exports["./client"]` via the `dsh.client` manifest.

## Behavior

A session header never changes its own runtime. The chip therefore has two
responsibilities:

- **Label.** It always shows the runtime recorded on the current session
  header (absent = Native), following the current session on every list move.
- **Switch.** From a blank session, picking another driver connects the owning
  workspace under that runtime, reusing or creating a matching blank session.
  From a conversation with completed history, it forks the retained transcript
  under the target runtime and opens the child. The source remains unchanged.
  A transient toast says that switching mode inside a conversation can reduce
  execution quality because provider-private reasoning, tool state, and cache
  cannot be transferred exactly.

The pairing host halves are the `claude-agent` and Codex driver rows in the
deployment patch layer; without the selected driver, the switch fails loud at
`session.create` (`runtime-not-found`) and the chip surfaces the failure line.

## Model Experience

### Conversation runtime choice

#### What the model sees

This UI package inserts nothing. A cross-runtime fork causes the target alternative driver to add the retained visible transcript as a user-level recall on its first turn; that behavior is owned by `dsh-agent-loop` and the selected driver.

#### Token effect

The selector itself adds no tokens. A cross-runtime child pays once for the retained transcript recall on its first alternative-driver turn.

#### KV Cache effect

Blank-session switches add no cache effect. A cross-runtime conversation fork starts a new provider continuation, so it cannot reuse the source runtime's provider cache.

## Known Limitations and Deferred Work

- The roster is the fixed Native/Claude/Codex set. A deployment that mounts
  additional agent drivers does not list them until the selector reads the
  host's `driverRuntimes()` registry instead of the static set.
- A conversation switch is a child fork in the same workspace, not mutation of
  the source session. Visible history and current DSH context transfer, but
  provider-private reasoning, tool state, approvals, and cache do not; the UI
  therefore does not promise identical execution quality after switching.
