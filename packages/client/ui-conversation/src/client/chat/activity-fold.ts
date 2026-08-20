// Turn-activity folding: consecutive internal-execution Nodes collapse into
// one disclosure row so the chat flow reads like the conversation, not the
// execution log. Foldable material is tool-call rows, thinking-only
// Assistant steps, and — once a Turn closed with a final answer — its
// mid-turn narration too. A streaming Assistant step leaves the fold the
// moment it starts producing prose, so a final answer never streams inside a
// collapsed row, and a running question call stays in place because the
// reader — not the agent — is on the hook. Everything else (user rows,
// errors, turn footers, …) stays a barrier that splits runs.

import type {
  AssistantBlock, ChatConversationViewNode, PartialAssistant,
} from '@voyaseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

/** Structural facts grouping needs, derived once per flow-shape change. */
export interface FoldFacts {
  /** `finalNode.seq` of every completed Turn's closing Assistant. */
  readonly closingSeqs: ReadonlySet<number>
  /** Turn numbers that closed with a text-bearing closing Assistant. */
  readonly closedWithClosing: ReadonlySet<number>
}

/** Deterministic key information retained in a collapsed activity summary. */
export type ActivityHighlight =
  | { readonly kind: 'tool'; readonly name: string; readonly status: 'running' | 'success' | 'error' }
  | { readonly kind: 'text'; readonly text: string }

/** One rendered row of the grouped chat flow. */
export type ChatFlowRow =
  | { readonly kind: 'node'; readonly key: string }
  | {
    readonly kind: 'fold'
    /** Stable identity: the first member's key (membership only grows at the tail). */
    readonly key: string
    readonly members: readonly string[]
    /** True while any member is still running. */
    readonly running: boolean
    /** Root tool calls in the fold, for the step-count figure. */
    readonly toolCalls: number
    /** Earliest member start time (epoch ms); null when no member carries one. */
    readonly startTime: number | null
    /** Latest member end time (epoch ms); null while the fold still runs. */
    readonly endTime: number | null
    /** At most two recent tool outcomes plus the last visible narration. */
    readonly highlights: readonly ActivityHighlight[]
  }

/**
 * Reader display inputs beyond the flow itself: the inline-reasoning
 * preference plus whether the streaming partial already carries reasoning.
 * Absent means the folded, conversation-shaped default.
 */
export interface ReasoningDisplay {
  /** Keep reasoning-bearing Assistant steps out of the activity fold. */
  readonly showReasoning: boolean
  /** The streaming partial already carries reasoning blocks. */
  readonly partialReasoning: boolean
}

/**
 * Test whether one Assistant block list carries user-facing prose (anything
 * beyond reasoning and tool-call heads).
 * @param blocks - Assistant content blocks.
 * @returns whether a visible non-reasoning block with content exists.
 */
export function hasVisibleProse(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some((block) => {
    if (block.kind === 'text') return block.text.trim() !== ''
    if (block.kind === 'reasoning' || block.kind === 'tool-call') return false
    return true
  })
}

/**
 * Test whether the streaming partial already carries user-facing prose.
 * @param partial - in-progress assistant output, when one is streaming.
 * @returns whether the partial must stay visible outside any fold.
 */
export function partialHasVisibleProse(partial: PartialAssistant | null): boolean {
  return partial !== null && hasVisibleProse(partial.blocks)
}

/**
 * Test whether the streaming partial already carries reasoning blocks.
 * @param partial - in-progress assistant output, when one is streaming.
 * @returns whether the partial's reasoning must stay visible outside any fold.
 */
export function partialHasReasoning(partial: PartialAssistant | null): boolean {
  return partial !== null && partial.blocks.some(block => block.kind === 'reasoning')
}

/**
 * Collect the closing facts grouping reads off the flow.
 * @param order - visible flow keys in render order.
 * @param store - chat node reader keyed by flow key.
 * @returns closing seqs and closed-with-closing turn numbers.
 */
export function collectFoldFacts(
  order: readonly string[],
  store: { get(key: string): ChatConversationViewNode | undefined },
): FoldFacts {
  const closingSeqs = new Set<number>()
  const closedWithClosing = new Set<number>()
  for (const key of order) {
    const node = store.get(key) as ChatNode | undefined
    if (node?.kind !== 'turn-tail' || node.data.closing === null) continue
    closingSeqs.add(node.data.closing.finalNode.seq)
    closedWithClosing.add(node.data.turn)
  }
  return { closingSeqs, closedWithClosing }
}

/** Tool name of the interactive question call (`ask_user_question`). */
const ASK_USER_TOOL = 'ask_user_question'

/**
 * Decide whether one Node belongs inside an activity fold.
 * @param node - flow Node, when resolvable.
 * @param facts - closing facts for the current flow.
 * @param partialProse - whether the streaming partial already shows prose.
 * @param display - inline-reasoning reader preference; absent folds everything.
 * @returns whether the Node folds away instead of rendering in place.
 */
export function isFoldable(
  node: ChatConversationViewNode | undefined,
  facts: FoldFacts,
  partialProse: boolean,
  display?: ReasoningDisplay,
): node is ChatNode {
  if (node === undefined) return false
  if (node.kind === 'tool-call') {
    const root = (node as ChatNode<'tool-call'>).data.root
    // A running question call waits on the reader, not on execution; keep it
    // in place so the pending question stays legible beside the composer it
    // takes over. Answered calls fold like any other tool row.
    if (isRunningTool(root) && root.name === ASK_USER_TOOL) return false
    return true
  }
  if (node.kind !== 'assistant-step') return false
  const data = (node as ChatNode<'assistant-step'>).data
  const hasReasoning = data.blocks.some(block => block.kind === 'reasoning')
  if (data.status === 'running') {
    // The one streaming step IS the partial; once it produces prose it must
    // render in place so the answer streams visibly.
    if (display?.showReasoning === true && (hasReasoning || display.partialReasoning)) return false
    return !partialProse
  }
  if (display?.showReasoning === true && hasReasoning) return false
  if (hasVisibleProse(data.blocks)) {
    if (data.finalNode !== undefined && facts.closingSeqs.has(data.finalNode.seq)) return false
    // Mid-turn narration folds only when its Turn demonstrably closed with a
    // final answer; otherwise the prose might be all the Turn ever said.
    return facts.closedWithClosing.has(data.turn)
  }
  return true
}

interface MemberTimes {
  readonly start: number | null
  readonly end: number | null
}

function memberTimes(node: ChatNode): MemberTimes {
  if (node.kind === 'tool-call') {
    const root = node.data.root
    return isRunningTool(root)
      ? { start: root.time, end: null }
      : { start: root.callTime ?? root.time, end: root.time }
  }
  if (node.kind === 'assistant-step') {
    const data = node.data
    if (data.status === 'running') return { start: data.time, end: null }
    const end = data.finalNode?.timing?.completedTime ?? data.time
    return { start: data.time, end }
  }
  return { start: null, end: null }
}

function boundedLine(text: string, maxChars = 120): string {
  const normalized = text.replaceAll(/\s+/gu, ' ').trim()
  const points = Array.from(normalized)
  return points.length <= maxChars ? normalized : `${points.slice(0, maxChars - 1).join('')}…`
}

function memberHighlight(node: ChatNode): ActivityHighlight | undefined {
  if (node.kind === 'tool-call') {
    const root = node.data.root
    const name = isRunningTool(root) ? root.name : root.call?.name ?? root.callId
    return {
      kind: 'tool',
      name: boundedLine(name, 80),
      status: isRunningTool(root) ? 'running' : root.isError ? 'error' : 'success',
    }
  }
  if (node.kind !== 'assistant-step') return
  const text = node.data.blocks.findLast(block => block.kind === 'text' && block.text.trim() !== '')
  return text?.kind === 'text' ? { kind: 'text', text: boundedLine(text.text) } : undefined
}

/**
 * Group the visible flow into single rows and activity folds.
 * @param order - visible flow keys in render order.
 * @param store - chat node reader keyed by flow key.
 * @param facts - closing facts for the current flow.
 * @param partialProse - whether the streaming partial already shows prose.
 * @param display - inline-reasoning reader preference; absent folds everything.
 * @returns ordered rows; consecutive foldable Nodes merge into one fold.
 */
export function groupChatFlow(
  order: readonly string[],
  store: { get(key: string): ChatConversationViewNode | undefined },
  facts: FoldFacts,
  partialProse: boolean,
  display?: ReasoningDisplay,
): ChatFlowRow[] {
  const rows: ChatFlowRow[] = []
  let members: string[] | null = null
  let running = false
  let toolCalls = 0
  let startTime: number | null = null
  let endTime: number | null = null
  let toolHighlights: ActivityHighlight[] = []
  let textHighlight: ActivityHighlight | undefined
  const flush = (): void => {
    if (members === null) return
    const first = members[0]
    if (first === undefined) return
    rows.push({
      kind: 'fold',
      key: `fold:${first}`,
      members,
      running,
      toolCalls,
      startTime,
      endTime: running ? null : endTime,
      highlights: [...toolHighlights, ...(textHighlight === undefined ? [] : [textHighlight])],
    })
    members = null
    running = false
    toolCalls = 0
    startTime = null
    endTime = null
    toolHighlights = []
    textHighlight = undefined
  }
  for (const key of order) {
    const node = store.get(key)
    if (!isFoldable(node, facts, partialProse, display)) {
      flush()
      rows.push({ kind: 'node', key })
      continue
    }
    if (members === null) members = []
    members.push(key)
    if (node.kind === 'tool-call') toolCalls += 1
    const highlight = memberHighlight(node)
    if (highlight?.kind === 'tool') toolHighlights = [...toolHighlights, highlight].slice(-2)
    if (highlight?.kind === 'text') textHighlight = highlight
    const times = memberTimes(node)
    const open = times.end === null
    running ||= open
    if (times.start !== null && times.start > 0) {
      startTime = startTime === null ? times.start : Math.min(startTime, times.start)
    }
    if (times.end !== null && times.end > 0) {
      endTime = endTime === null ? times.end : Math.max(endTime, times.end)
    }
  }
  flush()
  return rows
}
