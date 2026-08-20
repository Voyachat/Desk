# @voyaseek-ai/dsh-client-ui-workflow-run

English | [中文](README.zh.md)

The browser plugin that reconstructs durable top-level workflow runs as independent Chat nodes and a current-session dashboard in the session header. It consumes the four `tool-workflow/*` Session events owned by [`dsh-tool-workflow`](../../workflow/tool-workflow/README.md), registers one `ConversationNodeDefinition`, and adds entries through the keyed `conversation.chat.node` and additive `conversation.session.header.actions` slots without changing the existing workflow tool card.

## Durable state and replay

`tool-workflow/run-start` creates one Context keyed by `runId` and retains the originating `callId`; member starts, member endings, and the run ending update that Context in log order. A history tail containing only updates remains pending until an older page supplies the unique start, after which prepend, complete replay, and live append produce the same state. The projection distinguishes `pending`, `running`, `succeeded`, `failed`, `cancelled`, and `interrupted`. A closed Turn or Step with missing terminal events presents the affected run or members as interrupted without changing the tool result, but only an explicit durable `interrupted` or `error` run ending makes the recovery action available.

Phase groups come only from members that actually started. Exact phase strings share a group, an omitted phase is distinct from the empty string, and settlement changes status without removing or reordering members.

## Presentation and navigation

The run and each phase are controlled disclosures in every status. A mount opens running, failed, cancelled, and interrupted levels and closes fully completed levels; users can then toggle either level with the full row, Enter, or Space. Ordinary running updates preserve the current choice, the first abnormal edge opens once, normal completion closes once, and a completed phase plus the outer run open again when a new running member starts under the same phase key. If an entire new clean cycle arrives in one render while the run remains active, the phase finishes folded but the outer run opens once to expose its updated summary. Completion updates the visible status immediately but delays its automatic close while focus remains inside the content. `WorkflowRunPanel` owns the phase choices, so closing and reopening the outer run does not reset them; a renderer remount reconstructs every initial choice from durable facts. The run uses a 32-pixel `--dsw-alias-bg-module-platform` row with persistent right/down chevrons and an inline state dot plus status text, without a badge. Phases use 32-pixel disclosure rows with title and member count in the flexible main area and a fixed precise aggregate-status tail, without another dot. Members use a 16-pixel dot slot, a truncating name area, and a fixed 64-pixel status column.

A member opens a child Session only while every current fact agrees: the member is running, the child id is in the ordinary Session list, the row has `origin: 'subagent'`, its `parentId` is the current Session, and the list row is still running. Underlined member text is the only visible navigation affordance; keyboard focus draws a two-pixel business-primary ring around the name area, while status copy remains `Running`. The component calls only the injected ordinary `sessions.open(id)` action; remote, addressed-only, wrong-parent, or terminal rows remain non-interactive.

Every Chat node exposes `Inspect call`, which opens the originating tool call through the existing conversation inspector. Durably failed or interrupted nodes also show a recovery marker and a two-step `Retry from start` or `Recover from start` action. The action invokes the Host command and never changes the old run's terminal state.

The header entry is discoverable whenever the loaded current Session contains at least one workflow node. Its dashboard aggregates multiple runs in transcript order, shows each run's status and started-step count, expands phase/member details, and exposes the same confirmed from-start action for recoverable runs. It reads the existing Conversation snapshot and owns no duplicate workflow state.

## Composition

The package registers its Definition, locale dictionary, keyed `workflow-run` renderer, and session-header dashboard as Cordis effects. Removing the client entry retracts all four contributions. The shipped Web bundle includes the plugin after `ui-conversation` and `ui-tool`.

## Model Experience

None, as this package renders durable Session facts for humans and adds no prompt, tool schema, request content, or model-visible result.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- Only top-level calls through `dsh-tool-workflow` produce these records; nested Code Mode calls and direct `WorkflowEngine` consumers do not.
- The dashboard covers workflow nodes in the loaded current Session window. It is not a cross-session query, and an older run outside the paged window appears only after that history is loaded.
- Navigation is intentionally live-only. Terminal members remain visible for review but never expose a cold-session opener from this node.
- The dashboard and node show run, phase, member identity, and status. Script/output inspection stays in the existing tool-call inspector; logs, usage, and static topology remain outside this surface.
