# Agent Note: Chat view virtualization and scroll-driven paging

Status: implemented

## Problem

Long-running sessions crashed the web frontend: once a conversation grew,
every loaded row (markdown, KaTeX, code blocks, tool trees) stayed mounted in
the DOM and the session event window grew monotonically, until renderer
memory pressure or a render error took down the page — readers lost the
composer and the transcript with it. `ChatView` rendered the entire flow as
plain flex children, and loading older history required a manual button per
page.

## Decision

`ChatView` mounts the flow through `@tanstack/react-virtual` (the same
library and ledger pattern as `ui-trajectory`) once the grouped row count
crosses `VIRTUALIZATION_THRESHOLD_ROWS` (100). Off-window rows unmount;
dynamic heights are measured on mount; the column's 16px rhythm rides the
library's `gap` option so virtualized spacing matches the plain-flex flow
exactly. Prepend anchoring and estimate correction delegate to the library's
`anchorTo: 'end'` instead of the manual `anchorRef` path, which now owns only
the sub-threshold flow. Bottom-follow keeps this view's existing
ResizeObserver chain, and open-restore runs two phases: the saved raw offset
lands the window near the anchor, then a bounded `scrollToIndex` retry mounts
the anchor row and refines its exact position.

While virtualized, scrolling into the top 320px auto-requests one older page
per visit (`OLDER_AUTOLOAD_THRESHOLD_PX`), rearming when the reader leaves
the zone; the prepend's own anchor shift pushes the position out of the zone,
so settled pages never refire. Sub-threshold flows keep the header button as
the only paging path, which preserves every existing non-virtualized scroll
contract.

## Alternatives considered

Virtualizing without a row threshold was rejected because jsdom unit tests
and short sessions would pay the virtualizer's coordination cost for no DOM
saving. A hand-rolled windowing renderer was rejected because the vendored
library already solves reverse-scroll anchoring, estimate compensation, and
dynamic measurement, and `ui-trajectory` proves the pattern in this repo.
Auto-loading below the threshold was rejected because it would race the
button-driven history contracts in `chat-scroll-contract.e2e.ts` for no
user-facing gain on one-page remainders.

## Consequences

DOM size for a long conversation is bounded by the visible window plus
overscan instead of the loaded history. The data-layer event window still
grows monotonically (renderer memory is dominated by mounted rows first);
capping it is a separate change. Browser e2e contracts
(`chat-long-interactions`, `chat-scroll-contract`) are virtualization-neutral
by design and must stay green against this change.
