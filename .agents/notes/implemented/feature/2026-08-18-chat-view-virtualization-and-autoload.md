# Agent Note: Chat view virtualization and scroll-driven paging

Status: implemented

English | [中文](2026-08-18-chat-view-virtualization-and-autoload.zh.md)

## Problem

Long-running sessions crashed the web frontend: once a conversation grew, every loaded row (markdown, KaTeX, code blocks, tool trees) stayed mounted in the DOM and the session event window grew monotonically, until renderer memory pressure or a render error took down the page — readers lost the composer and the transcript with it. `ChatView` rendered the entire flow as plain flex children, and loading older history required a manual button per page.

## Decision

`ChatView` mounts the flow through `@tanstack/react-virtual` (the same library and ledger pattern as `ui-trajectory`) once the grouped row count crosses `VIRTUALIZATION_THRESHOLD_ROWS` (100). Off-window rows unmount; dynamic heights are measured on mount; the column's 16px rhythm rides the library's `gap` option so virtualized spacing matches the plain-flex flow exactly. The virtualizer resolves stable keys across prepend, while `ChatView` keeps the reader's semantic row and viewport offset through the following measurement frames; new wheel, touch, pointer, or keyboard intent cancels that bounded correction immediately. The same semantic position compensates responsive column and composer resizing while the reader is away from the bottom. Open-restore runs two phases: the saved raw offset lands the window near the anchor, then a bounded `scrollToIndex` retry mounts the anchor row and refines its exact position.

While virtualized, scrolling into the top 320px auto-requests one older page per visit (`OLDER_AUTOLOAD_THRESHOLD_PX`), rearming when the reader leaves the zone; the prepend's own anchor shift pushes the position out of the zone, so settled pages never refire. Sub-threshold flows keep the header button as the only paging path, which preserves every existing non-virtualized scroll contract.

The browser Session also retains at most `SESSION_EVENT_WINDOW_LIMIT` (5,000) contiguous raw events. Paging requests only the remaining capacity and removes the older-page action when the window is full. If live delivery crosses the limit, the Session drops one bounded old chunk and rebuilds the Conversation assembler from the retained contiguous range; the resulting leading gap remains explicit, while the latest turn and live stream stay resident.

## Alternatives considered

Virtualizing without a row threshold was rejected because jsdom unit tests and short sessions would pay the virtualizer's coordination cost for no DOM saving. A hand-rolled windowing renderer was rejected because the existing library supplies the window, key mapping, estimate compensation, and measurement primitives, and `ui-trajectory` proves the pattern in this repo. Delegating all prepend behavior to `anchorTo: 'end'` was rejected after browser tests showed that concurrent streaming and responsive reflow can continue changing measured heights after the first library correction. Auto-loading below the threshold was rejected because it would race the button-driven history contracts in `chat-scroll-contract.e2e.ts` for no user-facing gain on one-page remainders. Bidirectional window paging was rejected for this iteration because the Host history API has no forward cursor; the bounded client window instead preserves the live tail and permits older paging only while capacity remains.

## Consequences

DOM size for a long conversation is bounded by the visible window plus overscan instead of the loaded history. The data-layer raw events, wire views, and Conversation indexes are bounded by the contiguous Session window. Very old history remains durable on the Host but becomes unavailable from that already-full browser window until the session is reopened; live delivery may expose paging capacity again after an old chunk is pruned. Browser e2e contracts (`chat-long-interactions`, `chat-scroll-contract`) cover concurrent history/streaming, tool disclosure, reader input, tab and session restoration, responsive resizing, and long-message interaction.
