// Turn-activity folding: consecutive internal-execution Nodes collapse into
// one disclosure row so the chat flow reads like the conversation, not the
// execution log. Foldable material is tool-call rows, thinking-only
// Assistant steps, and — once a Turn closed with a final answer — its
// mid-turn narration too. A streaming Assistant step leaves the fold the
// moment it starts producing prose, so a final answer never streams inside a
// collapsed row. Everything else (user rows, errors, turn footers, …) stays
// a barrier that splits runs.

import type {
  AssistantBlock, ChatConversationViewNode, PartialAssistant,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

/** Structural facts grouping needs, derived once per flow-shape change. */
export interface FoldFacts {
  /** `finalNode.seq` of every completed Turn's closing Assistant. */
  readonly closingSeqs: ReadonlySet<number>
  /** Turn numbers that closed with a text-bearing closing Assistant. */
  readonly closedWithClosing: ReadonlySet<number>
}

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

/**
 * Decide whether one Node belongs inside an activity fold.
 * @param node - flow Node, when resolvable.
 * @param facts - closing facts for the current flow.
 * @param partialProse - whether the streaming partial already shows prose.
 * @returns whether the Node folds away instead of rendering in place.
 */
export function isFoldable(
  node: ChatConversationViewNode | undefined,
  facts: FoldFacts,
  partialProse: boolean,
): node is ChatNode {
  if (node === undefined) return false
  if (node.kind === 'tool-call') return true
  if (node.kind !== 'assistant-step') return false
  const data = (node as ChatNode<'assistant-step'>).data
  if (data.status === 'running') {
    // The one streaming step IS the partial; once it produces prose it must
    // render in place so the answer streams visibly.
    return !partialProse
  }
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

/**
 * Group the visible flow into single rows and activity folds.
 * @param order - visible flow keys in render order.
 * @param store - chat node reader keyed by flow key.
 * @param facts - closing facts for the current flow.
 * @param partialProse - whether the streaming partial already shows prose.
 * @returns ordered rows; consecutive foldable Nodes merge into one fold.
 */
export function groupChatFlow(
  order: readonly string[],
  store: { get(key: string): ChatConversationViewNode | undefined },
  facts: FoldFacts,
  partialProse: boolean,
): ChatFlowRow[] {
  const rows: ChatFlowRow[] = []
  let members: string[] | null = null
  let running = false
  let toolCalls = 0
  let startTime: number | null = null
  let endTime: number | null = null
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
    })
    members = null
    running = false
    toolCalls = 0
    startTime = null
    endTime = null
  }
  for (const key of order) {
    const node = store.get(key)
    if (!isFoldable(node, facts, partialProse)) {
      flush()
      rows.push({ kind: 'node', key })
      continue
    }
    if (members === null) members = []
    members.push(key)
    if (node.kind === 'tool-call') toolCalls += 1
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
