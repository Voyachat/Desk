# Agent Note: Chat view folds turn activity into one disclosure row

Status: implemented

## Problem

A long agent turn interleaved one row per reasoning block, one row per tool call, and mid-turn narration text, so the transcript read like an execution log. Users comparing against mainstream chat products saw dozens of internal-execution rows where a conversation should show the question, a compact working signal, and the answer.

## Decision

ChatView groups the visible flow before rendering. Consecutive foldable Nodes merge into one `ActivityFold` disclosure row, collapsed by default: `已处理` with the duration and root-tool-call count once settled, `正在处理` with a live clock while any member still runs. Expanding restores the original node seats in place under the summary line. Foldable material is tool-call rows, thinking-only Assistant steps, and — once the Turn closed with a text-bearing closing Assistant — its mid-turn narration. One exception stays in place while running: the `ask_user_question` call, because the reader — not the agent — is on the hook and the pending question must stay legible beside the composer the call takes over; answered calls fold like any other tool row. The closing final answer, user rows, error rows, and turn footers stay barriers that split runs.

Grouping derives from `order` plus structural closing facts collected from turn-tail nodes (closing `finalNode.seq` per turn). The only content-level input is a boolean selector over `chat.legacy.partial`: whether the streaming step already shows prose. A running Assistant step therefore leaves the fold the exact frame its first prose arrives, so a final answer never streams inside a collapsed row, and content-only chunk updates never regroup the flow. A running fold replaces the bare turn status as the working signal; the status still covers the node-less first-token wait. The fold row carries no paging anchor — member seats keep theirs — and fold identity is `fold:<first member key>`, stable because membership only grows at the tail.

## Alternatives considered

Grouping only consecutive think/tool rows while keeping narration visible was rejected because the user-visible goal is the mainstream one-line-per-turn posture, and mid-turn narration is internal detail once a final answer exists. Publishing a grouping signature from the Chat snapshot builder was rejected because the structural facts plus one boolean selector already cover every classification transition without a runtime contract change. Folding running Assistant steps unconditionally was rejected because a step that later produces prose would stream invisibly until the next structural event.

## Consequences

Completed turns render as the user bubble, one collapsed activity row, the final answer, and the turn footer. Live turns show narration or answer text as soon as it streams and keep all think/tool rows inside one live row; a pending question row stays visible outside the fold so the reader can answer without expanding anything. Tool-presentation acceptance suites that mount the real chat machinery expand the fold in their mount helpers before asserting rows (through the fold's own disclosure row only, never the member rows' own disclosures). Web e2e scenarios that drive folded member rows use the shared `expandActivityFolds` / `collapseActivityFolds` helpers, and the affected aria goldens were refreshed to the folded flow. A saved paging position whose anchor sits inside a collapsed fold falls back to the first visible row on restore.
