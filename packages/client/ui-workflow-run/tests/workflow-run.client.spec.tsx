// @vitest-environment jsdom
import { Context, Service } from '@voyaseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConversationEventRegistry, ConversationNodeAssembler, SlotRegistry,
} from '@voyaseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationMatch, ConversationNodeDefinition,
  ConversationSnapshot, ConversationViewDefinition, SessionId, SessionListState,
} from '@voyaseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@voyaseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@voyaseek-ai/dsh-client-test-runtime'
import {
  WorkflowRunPanel, type WorkflowRunInjected, type WorkflowRunPanelProps,
} from '../src/client/WorkflowRunPanel.tsx'
import {
  WorkflowDashboardAction, type WorkflowDashboardActionProps,
} from '../src/client/WorkflowDashboardAction.tsx'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import {
  workflowRunDefinition, type WorkflowRunChatData,
} from '../src/client/workflow-definition.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)

const PARENT_ID = 'parent' as SessionId
const CHILD_ID = 'child-1' as SessionId

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [workflowRunDefinition] }
  fallbackEntry(): undefined { return undefined }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] { return [chatViewDefinition] }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return { event: { seq, time: seq * 100, type, data } as ConversationEventInput['event'], view: undefined }
}

function matched(input: ConversationEventInput, role: ConversationMatch['role']): ConversationMatch {
  return { ...input, role, location: { kind: 'unresolved' } }
}

function assembler(entries: readonly ConversationEventInput[], hasMore = false): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

function workflowData(value: ConversationNodeAssembler): WorkflowRunChatData | undefined {
  const snapshot = value.snapshot('chat') as ChatSnapshot
  return [...snapshot.nodes.values()][0]?.data as WorkflowRunChatData | undefined
}

function completeEvents(): ConversationEventInput[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'step/start', { turn: 1, step: 1 }),
    at(3, 'tool-workflow/run-start', { runId: 'run-1', callId: 'call-1', name: 'audit' }),
    at(4, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 1, label: 'first', phase: '', childId: 'child-1',
    }),
    at(5, 'tool-workflow/agent-start', {
      runId: 'run-1', seq: 2, label: 'second', childId: 'child-2',
    }),
    at(6, 'tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'completed' }),
    at(7, 'tool-workflow/agent-end', { runId: 'run-1', seq: 2, outcome: 'failed' }),
    at(8, 'tool-workflow/run-end', { runId: 'run-1', stopReason: 'error' }),
    at(9, 'step/end', { turn: 1, step: 1 }),
    at(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('workflow-run Conversation Definition', () => {
  it('groups exact phase identities in first-member order and preserves terminal members', () => {
    const value = assembler(completeEvents())
    const data = workflowData(value)
    expect(data).toEqual({
      name: 'audit',
      callId: 'call-1',
      status: 'failed',
      resumable: true,
      phases: [
        {
          key: 'value:0:', phase: '',
          members: [{ seq: 1, label: 'first', childId: 'child-1', status: 'succeeded' }],
        },
        {
          key: 'missing', phase: null,
          members: [{ seq: 2, label: 'second', childId: 'child-2', status: 'failed' }],
        },
      ],
    })
    const node = [...(value.snapshot('chat') as ChatSnapshot).nodes.values()][0]!
    expect(node.anchorSeq).toBe(3)
    expect(node.kind).toBe('workflow-run')
  })

  it('keeps an update-only tail pending until prepend supplies the unique start', () => {
    const tail = completeEvents().slice(3)
    const value = assembler(tail, true)
    expect(workflowData(value)).toBeUndefined()
    value.prepend(completeEvents().slice(0, 3), false)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(completeEvents())))
  })

  it('produces the same final data through live append as complete replay', () => {
    const events = completeEvents()
    const value = assembler(events.slice(0, 3))
    for (const event of events.slice(3)) value.append(event)
    value.flush()
    expect(workflowData(value)).toEqual(workflowData(assembler(events)))
  })

  it('shows missing terminal facts as interrupted only after the owning Location closes', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'run-1', callId: 'call-1', name: 'audit' }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'run-1', seq: 1, label: 'worker', childId: 'child-1',
      }),
    ])
    expect(workflowData(value)?.status).toBe('running')
    value.append(at(5, 'step/end', { turn: 1, step: 1 }))
    value.flush()
    expect(workflowData(value)).toMatchObject({
      status: 'interrupted',
      resumable: false,
      phases: [{ members: [{ status: 'interrupted' }] }],
    })
  })

  it('projects an authoritative recovered ending as interrupted and explicitly resumable', () => {
    const value = assembler([
      at(1, 'tool-workflow/run-start', {
        runId: 'recovered', callId: 'call-recovered', name: 'recovered',
      }),
      at(2, 'tool-workflow/agent-start', {
        runId: 'recovered', seq: 1, label: 'open', childId: 'child-1',
      }),
      at(3, 'tool-workflow/agent-end', {
        runId: 'recovered', seq: 1, outcome: 'interrupted',
      }),
      at(4, 'tool-workflow/run-end', {
        runId: 'recovered', stopReason: 'interrupted',
      }),
    ])
    expect(workflowData(value)).toMatchObject({
      callId: 'call-recovered',
      status: 'interrupted',
      resumable: true,
      phases: [{ members: [{ status: 'interrupted' }] }],
    })
  })

  it('retains a zero-member run as its own succeeded node', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'tool-workflow/run-start', { runId: 'empty', callId: 'call-empty', name: 'empty' }),
      at(4, 'tool-workflow/run-end', { runId: 'empty', stopReason: 'completed' }),
    ])
    expect(workflowData(value)).toEqual({
      name: 'empty', callId: 'call-empty', status: 'succeeded', resumable: false, phases: [],
    })
  })

  it('folds same-phase cancellation and a turn-level interruption', () => {
    const cancelled = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', {
        runId: 'cancelled', callId: 'call-cancelled', name: 'cancelled',
      }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 1, label: 'one', phase: 'Research', childId: 'child-1',
      }),
      at(4, 'tool-workflow/agent-start', {
        runId: 'cancelled', seq: 2, label: 'two', phase: 'Research', childId: 'child-2',
      }),
      at(5, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 1, outcome: 'cancelled' }),
      at(6, 'tool-workflow/agent-end', { runId: 'cancelled', seq: 2, outcome: 'completed' }),
      at(7, 'tool-workflow/run-end', { runId: 'cancelled', stopReason: 'cancelled' }),
    ])
    expect(workflowData(cancelled)).toMatchObject({
      status: 'cancelled',
      phases: [{ phase: 'Research', members: [{ status: 'cancelled' }, { status: 'succeeded' }] }],
    })

    const interruptedTurn = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool-workflow/run-start', { runId: 'turn', callId: 'call-turn', name: 'turn' }),
      at(3, 'tool-workflow/agent-start', {
        runId: 'turn', seq: 1, label: 'open', childId: 'child-1',
      }),
      at(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(workflowData(interruptedTurn)?.status).toBe('interrupted')
  })

  it('handles session/unresolved placement and defensive Definition calls', () => {
    const sessionLevel = assembler([
      at(1, 'tool-workflow/run-start', { runId: 'session', callId: 'call-session', name: 'session' }),
      at(2, 'tool-workflow/agent-start', {
        runId: 'session', seq: 1, label: 'open', childId: 'child-1',
      }),
    ])
    expect(workflowData(sessionLevel)?.status).toBe('running')

    const invalidStart = matched(at(1, 'tool-workflow/agent-start', {
      runId: 'direct', seq: 1, label: 'member', childId: 'child-1',
    }), 'start')
    const emptyContext: Parameters<typeof workflowRunDefinition.start>[0] = {
      key: 'workflow-run:direct', kind: 'workflow-run', id: 'direct',
      matches: [invalidStart], start: invalidStart, state: undefined, current: new Map(),
    }
    const reader: Parameters<typeof workflowRunDefinition.start>[2] = { previous: () => undefined }
    expect(() => workflowRunDefinition.start(emptyContext, invalidStart, reader))
      .toThrow('workflow-run start requires tool-workflow/run-start')

    const start = matched(at(2, 'tool-workflow/run-start', {
      runId: 'direct', callId: 'call-direct', name: 'direct',
    }), 'start')
    const startedContext = { ...emptyContext, matches: [start], start }
    const state = workflowRunDefinition.start(startedContext, start, reader)
    const updateContext: Parameters<typeof workflowRunDefinition.update>[0] = { ...startedContext, state }
    const unrelated = matched(at(3, 'turn/start', { turn: 1 }), 'update')
    expect(workflowRunDefinition.update(updateContext, unrelated)).toBe(state)
    expect(workflowRunDefinition.target).toBe('chat')
    expect(workflowRunDefinition.buildViewNode?.({
      ...updateContext, matches: [], start: undefined,
    })).toBeNull()
    const directNode = workflowRunDefinition.buildViewNode?.(updateContext) as ChatConversationViewNode | null | undefined
    if (directNode === null) throw new Error('expected direct workflow Chat node')
    if (directNode === undefined) throw new Error('expected workflow Chat view builder')
    expect(directNode.kind).toBe('workflow-run')
    expect((directNode.data as WorkflowRunChatData).status).toBe('pending')
  })
})

type TestWorkflowData = Omit<WorkflowRunChatData, 'callId' | 'resumable'>
  & Partial<Pick<WorkflowRunChatData, 'callId' | 'resumable'>>

function node(data: TestWorkflowData): WorkflowRunPanelProps['node'] {
  return {
    key: '12:workflow-runrun-1',
    kind: 'workflow-run',
    id: 'run-1',
    target: 'chat',
    anchorSeq: 3,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      callId: 'call-1' as WorkflowRunChatData['callId'],
      resumable: false,
      ...data,
    },
  }
}

const phase = (overrides: Partial<WorkflowRunChatData['phases'][number]> = {}): WorkflowRunChatData['phases'][number] => ({
  key: 'missing',
  phase: null,
  members: [{ seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: 'running' }],
  ...overrides,
})

const listState = (overrides: Partial<SessionListState> = {}): SessionListState => ({
  ids: [PARENT_ID, CHILD_ID],
  byId: {
    [PARENT_ID]: {
      id: PARENT_ID, displayTitle: 'parent', running: true, blank: false, updatedAt: 0,
    },
    [CHILD_ID]: {
      id: CHILD_ID, displayTitle: 'child', parentId: PARENT_ID, origin: 'subagent',
      running: true, blank: false, updatedAt: 0,
    },
  },
  current: PARENT_ID,
  phase: 'ready',
  subagentsByParent: {},
  jobsBySession: {},
  currentAddress: undefined,
  ...overrides,
})

function panelProps(data: TestWorkflowData, sessions = listState(), openSession = vi.fn()): WorkflowRunPanelProps {
  return {
    node: node(data),
    sessionId: PARENT_ID,
    useSessions: selector => selector(sessions),
    useSession: (() => undefined) as WorkflowRunPanelProps['useSession'],
    useProjection: () => undefined,
    useInput: () => { throw new Error('unused') },
    inputActions: { setDraft: () => {}, submit: () => {} } as unknown as WorkflowRunPanelProps['inputActions'],
    useWorkspaces: (() => undefined) as WorkflowRunPanelProps['useWorkspaces'],
    useTurnData: () => undefined,
    selectedCallId: undefined,
    cwd: undefined,
    openFile: () => {},
    inspectCall: () => {},
    forkAt: () => {},
    loadImage: () => Promise.reject(new Error('unused')),
    fileMentions: () => undefined,
    openSession,
    retryRun: vi.fn(async () => {}),
    t: makeTranslate(zh),
  }
}

describe('WorkflowRunPanel', () => {
  it('forces running run and phase content open without false disclosure controls', () => {
    const view = render(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'running', phases: [phase({ key: 'research', phase: 'Research' })],
    })} />)
    expect(screen.getByText('worker')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^audit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Research/ })).toBeNull()
    const rows = [...view.container.querySelectorAll('[data-disclosure-row]')]
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.getAttribute('role')).toBeNull()
      expect(row.getAttribute('tabindex')).toBeNull()
      expect(row.getAttribute('aria-expanded')).toBeNull()
      expect(row.getAttribute('data-expandable')).toBeNull()
    }
  })

  it('folds each clean transition once and preserves review choices until activity returns', () => {
    const running: TestWorkflowData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    const phaseCompleted: TestWorkflowData = {
      ...running,
      phases: [phase({
        members: [{
          seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'succeeded',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(phaseCompleted)} />)
    const phaseHeader = screen.getByRole('button', { name: /未分阶段/ })
    expect(phaseHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('done')).toBeNull()
    fireEvent.click(phaseHeader)
    expect(screen.getByText('done')).toBeTruthy()

    const succeeded: TestWorkflowData = { ...phaseCompleted, status: 'succeeded' }
    view.rerender(<WorkflowRunPanel {...panelProps(succeeded)} />)
    const runHeader = screen.getByRole('button', { name: /^audit/ })
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('未分阶段')).toBeNull()
    fireEvent.keyDown(runHeader, { key: 'ArrowDown' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(runHeader, { key: 'Enter' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    const completedPhase = screen.getByRole('button', { name: /未分阶段/ })
    fireEvent.keyDown(completedPhase, { key: 'Enter' })
    expect(screen.getByText('done')).toBeTruthy()
    fireEvent.keyDown(runHeader, { key: ' ' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(runHeader, { key: ' ' })
    expect(runHeader.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    expect(screen.getByText('done')).toBeTruthy()

    const cleanUpdate: TestWorkflowData = {
      ...succeeded,
      phases: [phase({
        members: [{
          seq: 1, label: 'reviewed', childId: 'child-1' as SessionId, status: 'succeeded',
        }],
      })],
    }
    view.rerender(<WorkflowRunPanel {...panelProps(cleanUpdate)} />)
    expect(screen.getByText('reviewed')).toBeTruthy()

    view.rerender(<WorkflowRunPanel {...panelProps(running)} />)
    expect(screen.queryByRole('button', { name: /^audit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /未分阶段/ })).toBeNull()
    expect(screen.getByText('worker')).toBeTruthy()
    view.rerender(<WorkflowRunPanel {...panelProps(succeeded)} />)
    expect(screen.getByRole('button', { name: /^audit/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('未分阶段')).toBeNull()
  })

  it('refolds a phase when a complete activity cycle arrives as one clean update', () => {
    const firstMember = {
      seq: 1, label: 'first', childId: 'child-1' as SessionId, status: 'succeeded' as const,
    }
    const phaseClean: TestWorkflowData = {
      name: 'phase-cycle', status: 'running',
      phases: [phase({ members: [firstMember] })],
    }
    const phaseView = render(<WorkflowRunPanel {...panelProps(phaseClean)} />)
    fireEvent.click(screen.getByRole('button', { name: /未分阶段/ }))
    expect(screen.getByText('first')).toBeTruthy()
    phaseView.rerender(<WorkflowRunPanel {...panelProps({
      ...phaseClean,
      phases: [phase({ members: [firstMember, {
        seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'succeeded',
      }] })],
    })} />)
    expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('first')).toBeNull()
    expect(screen.queryByText('second')).toBeNull()
  })

  it('derives the zero-member running and succeeded states from the current run status', () => {
    const running: TestWorkflowData = { name: 'empty', status: 'running', phases: [] }
    const view = render(<WorkflowRunPanel {...panelProps(running)} />)
    expect(screen.queryByRole('button', { name: /^empty/ })).toBeNull()
    expect(screen.getByText('没有启动成员')).toBeTruthy()
    view.rerender(<WorkflowRunPanel {...panelProps({ ...running, status: 'succeeded' })} />)
    const header = screen.getByRole('button', { name: /^empty/ })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('没有启动成员')).toBeNull()
    fireEvent.click(header)
    expect(screen.getByText('没有启动成员')).toBeTruthy()
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'bubbles a %s member to the run and keeps a matching run outcome open',
    (status) => {
      const memberView = render(<WorkflowRunPanel {...panelProps({
        name: 'member-outcome', status: 'succeeded',
        phases: [phase({
          members: [{ seq: 1, label: status, childId: CHILD_ID, status }],
        })],
      })} />)
      expect(screen.queryByRole('button', { name: /^member-outcome/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /未分阶段/ })).toBeNull()
      expect(screen.getByText(status)).toBeTruthy()
      memberView.unmount()

      render(<WorkflowRunPanel {...panelProps({
        name: 'run-outcome', status,
        phases: [phase({
          members: [{ seq: 1, label: 'done', childId: CHILD_ID, status: 'succeeded' }],
        })],
      })} />)
      expect(screen.queryByRole('button', { name: /^run-outcome/ })).toBeNull()
      expect(screen.getByRole('button', { name: /未分阶段/ }).getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText('done')).toBeNull()
    },
  )

  it('keeps clean sibling phases independent and preserves empty versus absent names', () => {
    render(<WorkflowRunPanel {...panelProps({
      name: 'audit', status: 'succeeded',
      phases: [
        phase({ key: 'value:0:', phase: '', members: [{
          seq: 1, label: '', childId: 'child-1' as SessionId, status: 'succeeded',
        }] }),
        phase({ key: 'missing', phase: null, members: [{
          seq: 2, label: 'second', childId: 'child-2' as SessionId, status: 'running',
        }] }),
      ],
    })} />)
    expect(screen.queryByRole('button', { name: /^audit/ })).toBeNull()
    const cleanPhase = screen.getByRole('button', { name: /空阶段名/ })
    expect(cleanPhase.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /未分阶段/ })).toBeNull()
    expect(screen.queryByText('空成员名')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(cleanPhase)
    expect(screen.getByText('空成员名')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    fireEvent.click(cleanPhase)
    expect(screen.queryByText('空成员名')).toBeNull()
    expect(screen.getByText('second')).toBeTruthy()
  })

  it('renders mixed and interrupted aggregate status while attention stays visible', () => {
    const mixed: TestWorkflowData = {
      name: 'repo-audit', status: 'failed',
      phases: [phase({
        members: [
          { seq: 1, label: 'failed', childId: 'child-1' as SessionId, status: 'failed' },
          { seq: 2, label: 'cancelled', childId: 'child-2' as SessionId, status: 'cancelled' },
        ],
      })],
    }
    const mixedView = render(<WorkflowRunPanel {...panelProps(mixed)} />)
    expect(screen.getByText('失败 1 · 已取消 1')).toBeTruthy()
    expect([...mixedView.container.querySelectorAll('[data-member-status]')]
      .map(row => row.getAttribute('data-member-status'))).toEqual(['failed', 'cancelled'])
    expect(mixedView.container.querySelectorAll('[data-state="error"]')).toHaveLength(2)
    expect(mixedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(1)
    mixedView.unmount()

    const interruptedView = render(<WorkflowRunPanel {...panelProps({
      name: 'repo-audit', status: 'interrupted',
      phases: [phase({
        members: [
          { seq: 1, label: 'done', childId: 'child-1' as SessionId, status: 'succeeded' },
          { seq: 2, label: 'interrupted', childId: 'child-2' as SessionId, status: 'interrupted' },
        ],
      })],
    })} />)
    expect(screen.getByText('成功 1 · 已中断 1')).toBeTruthy()
    expect(interruptedView.container.querySelector('[data-run-status="interrupted"]')).toBeTruthy()
    expect(interruptedView.container.querySelectorAll('[data-state="warning"]')).toHaveLength(2)
  })

  it('opens only a running ordinary-list subagent proven to have this parent', () => {
    const data: TestWorkflowData = {
      name: 'audit', status: 'running', phases: [phase()],
    }
    const openSession = vi.fn()
    render(<WorkflowRunPanel {...panelProps(data, listState(), openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 worker' }))
    expect(openSession).toHaveBeenCalledWith('child-1')
  })

  it('exposes exact source inspection and a confirmed from-start recovery action', async () => {
    const inspectCall = vi.fn()
    const retryRun = vi.fn(async () => {})
    const props = panelProps({
      name: 'recovered', status: 'interrupted', resumable: true, phases: [],
    })
    render(<WorkflowRunPanel {...props} inspectCall={inspectCall} retryRun={retryRun} />)

    fireEvent.click(screen.getByRole('button', { name: '检查调用' }))
    expect(inspectCall).toHaveBeenCalledWith('call-1')
    fireEvent.click(screen.getByRole('button', { name: '从头重新运行' }))
    expect(retryRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认从头运行' }))
    await vi.waitFor(() => { expect(retryRun).toHaveBeenCalledWith('run-1') })
  })

  it.each([
    ['not in ordinary list', listState({ ids: [PARENT_ID] }), 'running'],
    ['remote row', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, origin: undefined },
    } }), 'running'],
    ['wrong parent', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, parentId: 'other' as SessionId },
    } }), 'running'],
    ['list terminal', listState({ byId: {
      ...listState().byId,
      [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false },
    } }), 'running'],
    ['member terminal', listState(), 'succeeded'],
  ] as const)('does not navigate when %s', (_name, sessions, memberStatus) => {
    const data: TestWorkflowData = {
      name: 'audit', status: 'running',
      phases: [phase({
        members: [{
          seq: 1, label: 'worker', childId: 'child-1' as SessionId, status: memberStatus,
        }],
      })],
    }
    render(<WorkflowRunPanel {...panelProps(data, sessions)} />)
    expect(screen.queryByRole('button', { name: '打开 worker' })).toBeNull()
    cleanup()
  })
})

function dashboardProps(
  runs: readonly ChatConversationViewNode[],
  retryRun = vi.fn(async () => {}),
): WorkflowDashboardActionProps {
  const byKey = new Map(runs.map(run => [run.key, run]))
  const snapshot = {
    chat: {
      order: runs.map(run => run.key),
      nodes: { get: (key: string) => byKey.get(key) },
    },
  } as unknown as ConversationSnapshot
  return {
    useSession: selector => selector(snapshot),
    retryRun,
    t: makeTranslate(zh),
  } as WorkflowDashboardActionProps
}

function dashboardRun(
  id: string,
  data: TestWorkflowData,
): ChatConversationViewNode {
  return {
    ...node(data),
    key: `workflow-run:${id}`,
    id,
  }
}

describe('WorkflowDashboardAction', () => {
  it('stays absent until the current loaded Session contains a workflow run', () => {
    const { container } = render(<WorkflowDashboardAction {...dashboardProps([])} />)
    expect(container.innerHTML).toBe('')
  })

  it('aggregates multiple current-session runs and confirms recovery from the header', async () => {
    const retryRun = vi.fn(async () => {})
    render(<WorkflowDashboardAction {...dashboardProps([
      dashboardRun('running', {
        name: 'running-audit', status: 'running', phases: [phase()],
      }),
      dashboardRun('recovered', {
        name: 'recovered-audit', status: 'interrupted', resumable: true,
        phases: [phase({
          members: [{
            seq: 1, label: 'interrupted-step', childId: CHILD_ID, status: 'interrupted',
          }],
        })],
      }),
    ], retryRun)} />)

    fireEvent.click(screen.getByRole('button', { name: '工作流 2' }))
    expect(screen.getByRole('dialog', { name: '当前会话工作流看板' })).toBeTruthy()
    expect(screen.getByText('running-audit')).toBeTruthy()
    expect(screen.getByText('recovered-audit')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /recovered-audit/ }))
    expect(screen.getByText('interrupted-step')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '从头重新运行' }))
    expect(retryRun).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认从头运行' }))
    await vi.waitFor(() => { expect(retryRun).toHaveBeenCalledWith('recovered') })
  })
})

class TestSessions extends Service {
  readonly opened: SessionId[] = []
  constructor(ctx: Context) { super(ctx, 'sessions') }
  open(id: SessionId): void { this.opened.push(id) }
}

describe('plugin lifecycle', () => {
  it('registers and removes the Definition and keyed renderer with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin(ConversationEventRegistry).await()
    await ctx.plugin(TestSessions).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    const entry = ctx.slots.entries('conversation.chat.node')[0]!
    const face = entry.inject?.() as unknown as WorkflowRunInjected
    face.openSession(CHILD_ID)
    expect((ctx.sessions as unknown as TestSessions).opened).toEqual([CHILD_ID])
    await fiber.dispose()
    expect(ctx.conversationEvents.entries()).toEqual([])
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.slots.entries('conversation.session.header.actions')).toEqual([])

    const replacement = ctx.plugin({ inject: [...inject], apply })
    await replacement.await()
    expect(ctx.conversationEvents.entries().map(entry => entry.kind)).toEqual(['workflow-run'])
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    await replacement.dispose()
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@voyaseek-ai/dsh-client-ui-workflow-run'])
  })
})
