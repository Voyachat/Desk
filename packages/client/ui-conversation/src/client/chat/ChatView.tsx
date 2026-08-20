// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition. Consecutive
// internal-execution Nodes (tool calls, thinking, mid-turn narration of a
// Turn that closed with a final answer) fold into one ActivityFold row, so
// the flow reads like the conversation, not the execution log.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.
// Grouping derives from order plus structural closing facts; the only
// content-level input is a boolean "the streaming partial already shows
// prose", which flips at most twice per step. Past VIRTUALIZATION_THRESHOLD_ROWS
// the flow mounts through @tanstack/react-virtual (the ui-trajectory ledger
// pattern): off-window rows unmount, dynamic heights are measured on mount,
// prepend anchoring and estimate correction ride the library's end anchor,
// and bottom-follow stays with this view's ResizeObserver chain.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ConversationTimelineSnapshot } from '@voyaseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { collectFoldFacts, groupChatFlow, partialHasReasoning, partialHasVisibleProse } from './activity-fold.ts'
import type { ChatFlowRow } from './activity-fold.ts'
import { ActivityFold } from './ActivityFold.tsx'
import { PendingSendBubble, PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24

/** Scrolling into this top zone auto-requests one older page per visit;
 *  leaving the zone rearms. The prepend's anchor shift pushes the reader back
 *  out of the zone, so pages chain only while the reader keeps scrolling up.
 *  The header button remains an explicit retry and accessibility path. */
const OLDER_AUTOLOAD_THRESHOLD_PX = 320

/** Rows beyond this mount through the virtualizer; shorter flows render in
 *  plain flex so unit tests and short sessions keep the simple path. Matches
 *  the ui-trajectory ledger threshold. */
const VIRTUALIZATION_THRESHOLD_ROWS = 100
/** Extra rows mounted on each side of the viewport; covers the header-gap
 *  slack and fast-wheel overshoot without ballooning the DOM. */
const VIRTUAL_OVERSCAN_ROWS = 8
/** Pre-measure row estimates; measureElement replaces them on mount. */
const VIRTUAL_ROW_ESTIMATE_PX = 160
const VIRTUAL_FOLD_ESTIMATE_PX = 32
const VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600
/** Mirrors the .column flex gap so virtualized item spacing matches the
 *  non-virtual flow exactly. */
const COLUMN_GAP_PX = 16
/** Bounded scrollToIndex retries while an off-window restore anchor mounts. */
const MAX_RESTORE_MOUNT_ATTEMPTS = 4
/** Bounded paint frames while virtual row estimates converge to measured sizes. */
const MAX_RESTORE_SETTLE_FRAMES = 30
const REQUIRED_RESTORE_STABLE_FRAMES = 8

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

interface PendingRestore extends ChatScrollPosition {
  /** Number of index jumps used to mount an off-window anchor. */
  mountAttempts: number
  /** Paint frames observed after the anchor mounted. */
  settleFrames: number
  /** Consecutive frames already within the geometry tolerance. */
  stableFrames: number
}

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}) {
  const [mountedAt] = useState(() => Date.now())
  // Anchored to turn/start so a mid-turn reload keeps the real
  // elapsed time and the final footer's Ran-for label matches this clock.
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      {t('chat.thinking')}
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
    </div>
  )
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView({
  useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  fileMentions, pendingSends, useShowReasoning, t,
}: ChatViewSlotProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const timeline = useSession(s => s.chat.timeline)
  // The only content-level grouping input: flips when the streaming step
  // starts/stops producing user-facing prose, never per chunk otherwise.
  const partialProse = useSession(s => partialHasVisibleProse(s.chat.legacy.partial))
  // Same flip discipline for the inline-reasoning preference: the streaming
  // step leaves the fold once its partial carries reasoning, never per chunk.
  const partialReasoning = useSession(s => partialHasReasoning(s.chat.legacy.partial))
  const showReasoning = useShowReasoning(value => value)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  /** One automatic older-page request per top-zone visit (see onScroll). */
  const olderArmedRef = useRef(true)
  /** Virtualized open-restore: the saved position waiting for its anchor row
   *  to mount into the window so the raw offset can be refined exactly. */
  const pendingRestoreRef = useRef<PendingRestore | null>(null)
  const restoreFrameRef = useRef<number | null>(null)
  const resizeAnchorFrameRef = useRef<number | null>(null)
  const readerScrollAtRef = useRef(0)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  // Activity folding: structural closing facts plus the prose flip decide
  // which consecutive Nodes collapse into one disclosure row. Recomputed on
  // flow-shape changes only; member content updates never regroup.
  const foldFacts = useMemo(() => collectFoldFacts(order, nodeStore), [order, nodeStore])
  const reasoningDisplay = useMemo(
    () => ({ showReasoning, partialReasoning }),
    [showReasoning, partialReasoning],
  )
  const rows = useMemo(
    () => groupChatFlow(order, nodeStore, foldFacts, partialProse, reasoningDisplay),
    [order, nodeStore, foldFacts, partialProse, reasoningDisplay],
  )
  // Some drivers settle each activity member before requesting the next one,
  // while the owning Turn remains open. Let a terminal fold carry that gap so
  // the working signal stays one disclosure instead of becoming a completed
  // fold followed by a separate TurnStatus row.
  const terminalRow = rows.at(-1)
  const continuingFoldKey = running && terminalRow?.kind === 'fold'
    ? terminalRow.key
    : null
  const hasRunningFold = rows.some(
    row => row.kind === 'fold' && (row.running || row.key === continuingFoldKey),
  )

  // ---- Windowed mounting over the settled flow -------------------------------
  // Long sessions otherwise accumulate every loaded row (markdown, KaTeX,
  // code blocks) in the DOM, which is the documented long-session crash
  // vector. The virtualizer mounts only the visible window plus overscan;
  // prepend anchoring and estimate correction ride the library's end anchor;
  // the semantic anchor below also protects both paths from concurrent stream
  // and responsive-layout growth while an older page is in flight.
  const virtualizationEnabled = rows.length > VIRTUALIZATION_THRESHOLD_ROWS

  // Item coordinates are list-local while scrollTop is scrollport-local; the
  // header block's height (plus its column gap) is the offset between them.
  const headerRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  useEffect(() => {
    const header = headerRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before effects run. */
    if (header === null) return
    const measure = (): void => {
      const height = header.offsetHeight
      setScrollMargin(height === 0 ? 0 : height + COLUMN_GAP_PX)
    }
    measure()
    /* v8 ignore next -- jsdom has no ResizeObserver; the initial read stands. */
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => { observer.disconnect() }
  }, [])

  const getScrollElement = useCallback((): HTMLElement | null => {
    const local = listRef.current
    return local === null ? null : scrollerOf(local)
  }, [])
  const estimateRowSize = useCallback(
    (index: number): number => rows[index]?.kind === 'fold'
      ? VIRTUAL_FOLD_ESTIMATE_PX
      : VIRTUAL_ROW_ESTIMATE_PX,
    [rows],
  )
  const getRowKey = useCallback(
    (index: number): string | number => rows[index]?.key ?? index,
    [rows],
  )
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: virtualizationEnabled ? rows.length : 0,
    enabled: virtualizationEnabled,
    estimateSize: estimateRowSize,
    getItemKey: getRowKey,
    getScrollElement,
    initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
    anchorTo: 'end',
    overscan: VIRTUAL_OVERSCAN_ROWS,
    scrollMargin,
    gap: COLUMN_GAP_PX,
    scrollEndThreshold: FOLLOW_THRESHOLD + 1,
  })
  const virtualItems = virtualizationEnabled ? rowVirtualizer.getVirtualItems() : []

  const renderMember = (nodeKey: string): ReactNode => (
    <ChatNodeSeat
      key={nodeKey}
      nodeKey={nodeKey}
      useSession={useSession}
      selectedCallId={selectedCallId}
      cwd={cwd}
      openFile={openFile}
      inspectCall={inspectCall}
      forkAt={forkAt}
      loadImage={loadImage}
      fileMentions={fileMentions}
      renderSlot={renderSlot}
      t={t}
    />
  )

  const renderRow = (row: ChatFlowRow): ReactNode => row.kind === 'node'
    ? renderMember(row.key)
    : (
      <ActivityFold
        members={row.members}
        running={row.running || row.key === continuingFoldKey}
        toolCalls={row.toolCalls}
        startTime={row.startTime}
        endTime={row.endTime}
        highlights={row.highlights}
        renderMember={renderMember}
        t={t}
      />
    )

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else if (virtualizationEnabled) {
        // The saved anchor row usually sits outside the initial window.
        // Restore the raw offset as the floor, then let the restore effect
        // pin the exact row once the window lands on it.
        pendingRestoreRef.current = {
          ...saved,
          mountAttempts: 0,
          settleFrames: 0,
          stableFrames: 0,
        }
        el.scrollTop = saved.scrollTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight. The
    // virtualized flow first asks the library to resolve the stable key into
    // the new index, then the second layout effect refines the exact top once
    // that row is mounted. This explicit semantic anchor is necessary when
    // streaming changes measurements while an older-page request is pending.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      if (virtualizationEnabled) {
        pendingRestoreRef.current = {
          anchorKey: anchor.key,
          anchorTop: anchor.top,
          scrollTop: el.scrollTop,
          mountAttempts: 0,
          settleFrames: 0,
          stableFrames: 0,
        }
      } else {
        const row = anchorElement(local, anchor.key)
        if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      }
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  // Virtualized open-restore, phase two: the raw offset lands the window near
  // the saved anchor; once that row mounts, pin it to its saved flow position
  // exactly. A collapsed fold never mounts member seats, so a fold-member
  // anchor degrades to the raw offset like the plain-flex path does.
  useLayoutEffect(() => {
    const pending = pendingRestoreRef.current
    if (pending === null) return
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    const finish = (): void => {
      if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
      restoreFrameRef.current = null
      pendingRestoreRef.current = null
      observedTopRef.current = el.scrollTop
      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
      atBottomRef.current = isAtBottom
      setAtBottom(isAtBottom)
      const position = isAtBottom ? null : scrollPosition(local, el)
      if (isAtBottom) chatScroll.save(null)
      else if (position !== null) chatScroll.save(position)
    }
    const row = anchorElement(local, pending.anchorKey)
    if (row !== null) {
      const settle = (): void => {
        const current = pendingRestoreRef.current
        if (current === null) return
        const currentRow = anchorElement(local, current.anchorKey)
        if (currentRow === null) {
          finish()
          return
        }
        const delta = flowTop(currentRow, el) - current.anchorTop
        if (Math.abs(delta) > 0.5) {
          el.scrollTop += delta
          observedTopRef.current = el.scrollTop
        }
        const stableFrames = Math.abs(delta) <= 0.5 ? current.stableFrames + 1 : 0
        const settleFrames = current.settleFrames + 1
        if (stableFrames >= REQUIRED_RESTORE_STABLE_FRAMES || settleFrames >= MAX_RESTORE_SETTLE_FRAMES) {
          finish()
          return
        }
        pendingRestoreRef.current = { ...current, settleFrames, stableFrames }
        restoreFrameRef.current = requestAnimationFrame(settle)
      }
      settle()
      return
    }
    const index = rows.findIndex(r => r.kind === 'node' && r.key === pending.anchorKey)
    if (index >= 0 && pending.mountAttempts < MAX_RESTORE_MOUNT_ATTEMPTS) {
      pendingRestoreRef.current = { ...pending, mountAttempts: pending.mountAttempts + 1 }
      rowVirtualizer.scrollToIndex(index, { align: 'start' })
      return
    }
    finish()
  })

  useEffect(() => () => {
    if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
    if (resizeAnchorFrameRef.current !== null) cancelAnimationFrame(resizeAnchorFrameRef.current)
  }, [])

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    if (movedByReader) {
      readerScrollAtRef.current = Date.now()
      if (resizeAnchorFrameRef.current !== null) cancelAnimationFrame(resizeAnchorFrameRef.current)
      resizeAnchorFrameRef.current = null
    }
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
    // Infinite paging: one older page per top-zone visit, armed again once the
    // reader leaves the zone. The prepend's own anchor shift pushes the
    // position out of the zone, so a settled page never refires in place; a
    // failed/empty page stays disarmed until the reader scrolls away.
    if (el.scrollTop > OLDER_AUTOLOAD_THRESHOLD_PX) {
      olderArmedRef.current = true
    } else if (hasMore && !loadingOlder && olderArmedRef.current) {
      olderArmedRef.current = false
      loadOlderAnchored()
    }
  }

  // Bind the scroll listener on the resolved scrollport once per mount.
  // Reader-input attribution rides the observed-top ledger; input listeners
  // only cancel a bounded virtual-anchor correction when the reader takes
  // control again before its measurement frames finish.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    const cancelRestore = (): void => {
      if (pendingRestoreRef.current === null) return
      pendingRestoreRef.current = null
      if (restoreFrameRef.current !== null) cancelAnimationFrame(restoreFrameRef.current)
      restoreFrameRef.current = null
    }
    const cancelForReader = (): void => {
      readerScrollAtRef.current = Date.now()
      cancelRestore()
      if (resizeAnchorFrameRef.current !== null) cancelAnimationFrame(resizeAnchorFrameRef.current)
      resizeAnchorFrameRef.current = null
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', cancelForReader, { passive: true })
    el.addEventListener('touchstart', cancelForReader, { passive: true })
    el.addEventListener('pointerdown', cancelRestore, { passive: true })
    el.addEventListener('keydown', cancelForReader)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', cancelForReader)
      el.removeEventListener('touchstart', cancelForReader)
      el.removeEventListener('pointerdown', cancelRestore)
      el.removeEventListener('keydown', cancelForReader)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, responsive reflow, and other flow changes
  // resize the column; the sticky composer resizes outside it. Pinned readers
  // follow the floor. Mid-flow readers keep the semantic row/top last saved by
  // the scroll handler, including when a tab stays mounted while its width
  // changes.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) {
        followRef.current?.()
        return
      }
      if (Date.now() - readerScrollAtRef.current < 120) return
      if (scrollport.clientHeight === 0) return
      const saved = chatScroll.read()
      if (saved === null) return
      if (resizeAnchorFrameRef.current !== null) cancelAnimationFrame(resizeAnchorFrameRef.current)
      let frames = 0
      let stableFrames = 0
      const correct = (): void => {
        resizeAnchorFrameRef.current = null
        if (atBottomRef.current || Date.now() - readerScrollAtRef.current < 120) return
        const row = anchorElement(local, saved.anchorKey)
        if (row === null) return
        const delta = flowTop(row, scrollport) - saved.anchorTop
        if (Math.abs(delta) > 0.5) {
          scrollport.scrollTop += delta
          observedTopRef.current = scrollport.scrollTop
          stableFrames = 0
        } else {
          stableFrames += 1
        }
        frames += 1
        if (stableFrames >= REQUIRED_RESTORE_STABLE_FRAMES || frames >= MAX_RESTORE_SETTLE_FRAMES) return
        resizeAnchorFrameRef.current = requestAnimationFrame(correct)
      }
      correct()
    })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => {
      observer.disconnect()
      if (resizeAnchorFrameRef.current !== null) cancelAnimationFrame(resizeAnchorFrameRef.current)
      resizeAnchorFrameRef.current = null
    }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div
          ref={columnRef}
          className={css.column}
          data-chat-flow=""
          data-chat-flow-row-count={rows.length}
        >
          <div ref={headerRef} className={css.header}>
            {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
            {openState === 'error' && openError !== null && (
              <div className={css.openError}>
                {t('chat.loadError', { message: openError.message, code: openError.code })}
              </div>
            )}
            {hasMore && (
              <div className={css.older}>
                <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                  {loadingOlder ? t('loading') : t('chat.loadOlder')}
                </button>
              </div>
            )}
          </div>
          {virtualizationEnabled ? (
            <div
              className={css.virtualBody}
              data-chat-virtual-body=""
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {virtualItems.map((item) => {
                const row = rows[item.index]
                /* v8 ignore next -- the virtualizer's count mirrors rows.length. */
                if (row === undefined) return null
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={rowVirtualizer.measureElement}
                    className={css.virtualRow}
                    style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
                  >
                    {renderRow(row)}
                  </div>
                )
              })}
            </div>
          ) : (
            rows.map(row => <Fragment key={row.key}>{renderRow(row)}</Fragment>)
          )}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step. A
              running activity fold already carries the working signal, so the
              status only covers the node-less first-token wait. */}
          {running && !hasRunningFold && <TurnStatus startTime={runningTurnStart} t={t} />}
          {pendingSends.map(send => (
            <PendingSendBubble key={send.sendId} content={send.content} t={t} />
          ))}
          {pendingSteering.map(item => (
            <PendingSteeringBubble key={item.id} content={item.content} loadImage={loadImage} t={t} />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
