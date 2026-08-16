// Activity folding logic: classification of foldable Nodes and the flow
// grouping pass that merges consecutive internal-execution Nodes into one
// fold row. Driven over hand-built view Nodes — no React or wire involved.

import { describe, expect, it } from 'vitest'
import type {
  AssistantBlock, ChatConversationViewNode, PartialAssistant,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  collectFoldFacts, groupChatFlow, hasVisibleProse, isFoldable, partialHasVisibleProse,
} from '../src/client/chat/activity-fold.ts'
import type { FoldFacts } from '../src/client/chat/activity-fold.ts'

const text = (value: string): AssistantBlock => ({ kind: 'text', text: value })
const reasoning = (value: string): AssistantBlock => ({ kind: 'reasoning', text: value })
const toolHead: AssistantBlock = { kind: 'tool-call', callId: 'c', name: 'bash', argsRaw: '{}' }
const image: AssistantBlock = { kind: 'image', attachment: { attachmentId: 'a1' } as never }

interface AssistantStepOptions {
  readonly turn?: number
  readonly step?: number
  readonly status?: 'running' | 'settled' | 'interrupted'
  readonly blocks?: readonly AssistantBlock[]
  readonly time?: number
  readonly finalSeq?: number
  readonly completedTime?: number
}

function assistantStep(key: string, options: AssistantStepOptions = {}): ChatConversationViewNode {
  const seq = options.finalSeq ?? 10
  return {
    key,
    id: key,
    target: 'chat',
    kind: 'assistant-step',
    anchorSeq: seq,
    location: { kind: 'session' },
    visibility: 'visible',
    data: {
      status: options.status ?? 'settled',
      turn: options.turn ?? 1,
      step: options.step ?? 1,
      blocks: options.blocks ?? [text('answer')],
      time: options.time ?? seq * 1000,
      ...options.finalSeq === undefined ? {} : {
        finalNode: {
          kind: 'assistant',
          seq: options.finalSeq,
          time: seq * 1000,
          turn: options.turn ?? 1,
          step: options.step ?? 1,
          blocks: options.blocks ?? [text('answer')],
          ...options.completedTime === undefined ? {} : {
            timing: { stepStartTime: null, firstTokenTime: null, completedTime: options.completedTime },
          },
        },
      },
    },
  } as unknown as ChatConversationViewNode
}

interface ToolOptions {
  readonly running?: boolean
  readonly name?: string
  readonly callTime?: number
  readonly resultTime?: number
  readonly startedAt?: number
}

function tool(key: string, options: ToolOptions = {}): ChatConversationViewNode {
  const running = options.running === true
  const startedAt = options.startedAt ?? 2_000
  const root = running
    ? {
      callId: key, name: options.name ?? 'bash', argsRaw: '{}',
      turn: 1, step: 1, time: startedAt, callView: null, subCalls: [],
    }
    : {
      kind: 'tool-result', seq: 3, time: options.resultTime ?? 3_000, callId: key,
      call: { name: options.name ?? 'bash', argsRaw: '{}' },
      callTime: options.callTime ?? startedAt,
      content: [], isError: false, callView: null, resultView: null, subCalls: [],
    }
  return {
    key,
    id: key,
    target: 'chat',
    kind: 'tool-call',
    anchorSeq: startedAt,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  } as unknown as ChatConversationViewNode
}

function turnTail(key: string, turn: number, closingSeq: number | null): ChatConversationViewNode {
  return {
    key,
    id: key,
    target: 'chat',
    kind: 'turn-tail',
    anchorSeq: 99,
    location: { kind: 'session' },
    visibility: 'visible',
    data: {
      turn,
      seq: 99,
      time: 9_000,
      closing: closingSeq === null ? null : { finalNode: { seq: closingSeq } },
      branchUnavailable: false,
    },
  } as unknown as ChatConversationViewNode
}

function barrier(key: string, kind = 'user'): ChatConversationViewNode {
  return {
    key,
    id: key,
    target: 'chat',
    kind,
    anchorSeq: 1,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { kind, seq: 1 },
  } as unknown as ChatConversationViewNode
}

function storeOf(nodes: readonly ChatConversationViewNode[]): {
  get(key: string): ChatConversationViewNode | undefined
} {
  const byKey = new Map(nodes.map(node => [node.key, node]))
  return { get: key => byKey.get(key) }
}

const EMPTY_FACTS: FoldFacts = { closingSeqs: new Set(), closedWithClosing: new Set() }

describe('hasVisibleProse', () => {
  it('accepts non-empty text and other visible block kinds', () => {
    expect(hasVisibleProse([text('hello')])).toBe(true)
    expect(hasVisibleProse([reasoning('hm'), text('hello')])).toBe(true)
    expect(hasVisibleProse([image])).toBe(true)
    expect(hasVisibleProse([{ kind: 'other', block: {} }])).toBe(true)
  })

  it('rejects blank text, reasoning, and tool-call heads', () => {
    expect(hasVisibleProse([])).toBe(false)
    expect(hasVisibleProse([text('   ')])).toBe(false)
    expect(hasVisibleProse([reasoning('private chain')])).toBe(false)
    expect(hasVisibleProse([toolHead])).toBe(false)
  })
})

describe('partialHasVisibleProse', () => {
  const partialOf = (blocks: readonly AssistantBlock[]): PartialAssistant => ({ turn: 1, step: 1, blocks })

  it('is false without a streaming partial', () => {
    expect(partialHasVisibleProse(null)).toBe(false)
  })

  it('mirrors the block classification for a streaming partial', () => {
    expect(partialHasVisibleProse(partialOf([reasoning('hm')]))).toBe(false)
    expect(partialHasVisibleProse(partialOf([text('visible')]))).toBe(true)
  })
})

describe('collectFoldFacts', () => {
  it('collects closing seqs and turn numbers from turn tails with a closing', () => {
    const store = storeOf([
      barrier('u1'),
      turnTail('t1', 1, 42),
      turnTail('t2', 2, null),
    ])
    const facts = collectFoldFacts(['u1', 't1', 't2'], store)
    expect(facts.closingSeqs.has(42)).toBe(true)
    expect(facts.closedWithClosing.has(1)).toBe(true)
    expect(facts.closedWithClosing.has(2)).toBe(false)
  })

  it('ignores nodes the store cannot resolve', () => {
    const facts = collectFoldFacts(['missing'], storeOf([]))
    expect(facts.closingSeqs.size).toBe(0)
    expect(facts.closedWithClosing.size).toBe(0)
  })
})

describe('isFoldable', () => {
  it('folds tool calls regardless of turn state', () => {
    expect(isFoldable(tool('c1'), EMPTY_FACTS, false)).toBe(true)
    expect(isFoldable(tool('c1', { running: true }), EMPTY_FACTS, true)).toBe(true)
  })

  it('keeps the streaming step visible once the partial shows prose', () => {
    const runningStep = assistantStep('a1', { status: 'running', blocks: [reasoning('hm')] })
    expect(isFoldable(runningStep, EMPTY_FACTS, false)).toBe(true)
    expect(isFoldable(runningStep, EMPTY_FACTS, true)).toBe(false)
  })

  it('never folds the closing final answer', () => {
    const closing = assistantStep('a1', { finalSeq: 42, blocks: [text('done')] })
    const facts = collectFoldFacts(['t1'], storeOf([turnTail('t1', 1, 42)]))
    expect(isFoldable(closing, facts, false)).toBe(false)
  })

  it('folds mid-turn narration only when the turn closed with a closing', () => {
    const narration = assistantStep('a1', { turn: 1, finalSeq: 10, blocks: [text('on it')] })
    const closed = collectFoldFacts(['t1'], storeOf([turnTail('t1', 1, 42)]))
    expect(isFoldable(narration, closed, false)).toBe(true)
    expect(isFoldable(narration, EMPTY_FACTS, false)).toBe(false)
  })

  it('keeps narration visible when the turn closed without any closing', () => {
    const narration = assistantStep('a1', { turn: 2, finalSeq: 10, blocks: [text('on it')] })
    const facts = collectFoldFacts(['t1'], storeOf([turnTail('t1', 2, null)]))
    expect(isFoldable(narration, facts, false)).toBe(false)
  })

  it('folds settled thinking-only steps even without a closed turn', () => {
    const thinkOnly = assistantStep('a1', { blocks: [reasoning('hm')] })
    expect(isFoldable(thinkOnly, EMPTY_FACTS, false)).toBe(true)
  })

  it('rejects unresolvable and non-activity nodes', () => {
    expect(isFoldable(undefined, EMPTY_FACTS, false)).toBe(false)
    expect(isFoldable(barrier('u1'), EMPTY_FACTS, false)).toBe(false)
    expect(isFoldable(barrier('t1', 'turn-tail'), EMPTY_FACTS, false)).toBe(false)
  })
})

describe('groupChatFlow', () => {
  it('returns an empty flow unchanged', () => {
    expect(groupChatFlow([], storeOf([]), EMPTY_FACTS, false)).toEqual([])
  })

  it('keeps barrier nodes as single rows', () => {
    const rows = groupChatFlow(['u1'], storeOf([barrier('u1')]), EMPTY_FACTS, false)
    expect(rows).toEqual([{ kind: 'node', key: 'u1' }])
  })

  it('merges consecutive activity into one fold with summary figures', () => {
    const nodes = [
      barrier('u1'),
      assistantStep('a1', { blocks: [reasoning('hm')], time: 1_000 }),
      tool('c1', { callTime: 1_500, resultTime: 3_000 }),
      tool('c2', { callTime: 3_200, resultTime: 4_000 }),
      barrier('t1', 'turn-tail'),
    ]
    const store = storeOf(nodes)
    const rows = groupChatFlow(nodes.map(node => node.key), store, EMPTY_FACTS, false)
    expect(rows.map(row => row.kind)).toEqual(['node', 'fold', 'node'])
    const fold = rows[1]
    if (fold === undefined || fold.kind !== 'fold') throw new Error('expected fold row')
    expect(fold.key).toBe('fold:a1')
    expect(fold.members).toEqual(['a1', 'c1', 'c2'])
    expect(fold.running).toBe(false)
    expect(fold.toolCalls).toBe(2)
    expect(fold.startTime).toBe(1_000)
    expect(fold.endTime).toBe(4_000)
  })

  it('splits runs at barrier nodes', () => {
    const nodes = [
      tool('c1'),
      barrier('u1'),
      tool('c2'),
    ]
    const store = storeOf(nodes)
    const rows = groupChatFlow(nodes.map(node => node.key), store, EMPTY_FACTS, false)
    expect(rows.map(row => row.kind === 'fold' ? `fold:${row.members.join(',')}` : row.key))
      .toEqual(['fold:c1', 'u1', 'fold:c2'])
  })

  it('marks a fold running while any member runs and drops its end time', () => {
    const nodes = [
      tool('c1', { callTime: 1_000, resultTime: 2_000 }),
      tool('c2', { running: true, startedAt: 2_500 }),
    ]
    const store = storeOf(nodes)
    const rows = groupChatFlow(nodes.map(node => node.key), store, EMPTY_FACTS, false)
    expect(rows).toHaveLength(1)
    const fold = rows[0]
    if (fold === undefined || fold.kind !== 'fold') throw new Error('expected fold row')
    expect(fold.running).toBe(true)
    expect(fold.startTime).toBe(1_000)
    expect(fold.endTime).toBeNull()
  })

  it('drops members without usable times from the duration figures', () => {
    const nodes = [assistantStep('a1', { status: 'running', blocks: [reasoning('hm')], time: 0 })]
    const store = storeOf(nodes)
    const rows = groupChatFlow(['a1'], store, EMPTY_FACTS, false)
    const fold = rows[0]
    if (fold === undefined || fold.kind !== 'fold') throw new Error('expected fold row')
    expect(fold.startTime).toBeNull()
    expect(fold.endTime).toBeNull()
    expect(fold.toolCalls).toBe(0)
  })

  it('folds mid-turn narration once the turn closes with a final answer', () => {
    const nodes = [
      assistantStep('a1', { turn: 1, finalSeq: 10, blocks: [text('on it')] }),
      tool('c1'),
      assistantStep('a2', { turn: 1, finalSeq: 42, blocks: [text('done')] }),
      turnTail('t1', 1, 42),
    ]
    const store = storeOf(nodes)
    const facts = collectFoldFacts(nodes.map(node => node.key), store)
    const rows = groupChatFlow(nodes.map(node => node.key), store, facts, false)
    expect(rows.map(row => row.kind === 'fold' ? `fold:${row.members.join(',')}` : row.key))
      .toEqual(['fold:a1,c1', 'a2', 't1'])
  })

  it('keeps a running streaming step out of the fold once prose arrives', () => {
    const nodes = [
      tool('c1'),
      assistantStep('a1', { status: 'running', blocks: [text('answering')] }),
    ]
    const store = storeOf(nodes)
    // Without prose yet, the streaming step is still internal material and
    // merges with the tool run ahead of it.
    const folded = groupChatFlow(nodes.map(node => node.key), store, EMPTY_FACTS, false)
    expect(folded.map(row => row.kind === 'fold' ? `fold:${row.members.join(',')}` : row.key))
      .toEqual(['fold:c1,a1'])
    const visible = groupChatFlow(nodes.map(node => node.key), store, EMPTY_FACTS, true)
    expect(visible.map(row => row.kind === 'fold' ? `fold:${row.members.join(',')}` : row.key))
      .toEqual(['fold:c1', 'a1'])
  })
})
