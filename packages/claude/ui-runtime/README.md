# @voyaseek-ai/dsh-claude-runtime-ui

Composer runtime selector: labels the agent driver the current session runs
under — Native (the DSH loop), Claude (the Claude Agent SDK driver), or Codex
(the OpenAI Codex driver) — and switches between them.

The browser half occupies the `conversation.input.left` composer seat (right
of the resident chrome, beside the plan chip). The node half is an empty
apply that exists only so the plugin appears in the host composition; the
surface ships through `exports["./client"]` via the `dsh.client` manifest.

## Behavior

A session never changes its own runtime: its history was produced under the
driver it was created with, and the host refuses to rebuild it under another.
The chip therefore has two responsibilities:

- **Label.** It always shows the runtime recorded on the current session
  header (absent = Native), following the current session on every list move.
- **Switch.** Picking the other driver connects the owning workspace under
  that runtime — reusing a blank session minted under it, else creating one —
  and opens the result. The switch never mutates the session it starts from.

The pairing host halves are the `claude-agent` and Codex driver rows in the
deployment patch layer; without the selected driver, the switch fails loud at
`session.create` (`runtime-not-found`) and the chip surfaces the failure line.

## Model Experience

- **Prompt**: none — the selector is a surface over session creation; it adds
  no model-visible input.
- **Tokens**: none.
- **KV cache**: none. The runtime choice is recorded on the session header at
  creation and never enters a model request.

## Known Limitations and Deferred Work

- The roster is the fixed Native/Claude/Codex set. A deployment that mounts
  additional agent drivers does not list them until the selector reads the
  host's `driverRuntimes()` registry instead of the static set.
- Switching always lands on a session in the same workspace; there is no
  in-place runtime change because the host contract forbids it by design.
