// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RpcReceipt } from '@voyaseek-ai/dsh-api-remotes/client'
import { RpcId } from '@voyaseek-ai/dsh-client-connection/client'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS, PendingWait,
} from '@voyaseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, SessionId,
} from '@voyaseek-ai/dsh-client-runtime/client'
import { zh as commonZh } from '@voyaseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SnapshotSelectorHook } from '@voyaseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@voyaseek-ai/dsh-client-test-runtime'
import type { ApprovalComposerProps, ApprovalWait } from '../src/client/contract/slots.ts'
import { zh } from '../src/client/locales.ts'
import { ApprovalPanel } from '../src/client/skeleton/ApprovalPanel.tsx'

afterEach(cleanup)

const SID = 'approval-session' as SessionId
const t: ApprovalComposerProps['t'] = makeTranslate(zh, commonZh)

const snapshot: ConversationSnapshot = {
  sessionId: SID,
  views: EMPTY_CONVERSATION_VIEWS,
  chat: EMPTY_CHAT_SNAPSHOT,
  nodes: [],
  turnTimings: new Map(),
  turnEnds: new Map(),
  partial: null,
  runningCalls: [],
  pending: [],
  queue: [],
  running: true,
  composerPhase: 'active',
  removed: false,
  openState: 'open',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  promptError: null,
  blank: false,
  subagent: null,
  lastAgentError: null,
}

const useSession: SnapshotSelectorHook<ConversationSnapshot> = select => select(snapshot)

function approval(
  rememberable: boolean,
  respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true })),
): { wait: ApprovalWait; respond: typeof respond } {
  const payload: ApprovalWait['payload'] = {
    approvalId: 'approval-1' as ApprovalWait['payload']['approvalId'],
    toolName: 'Write',
    ...(rememberable ? { rememberable: true } : {}),
  }
  return {
    wait: new PendingWait('approval', RpcId('approval-rpc'), SID, payload, respond),
    respond,
  }
}

function renderPanel(wait: ApprovalWait) {
  const props = { matched: wait, interactions: [wait], useSession, t } as unknown as ApprovalComposerProps
  return render(<ApprovalPanel {...props} />)
}

function decisionEnvelope(outcome: 'allowed-once' | 'allowed-and-remembered' | 'rejected') {
  return {
    type: 'client-response',
    rpcId: RpcId('approval-rpc'),
    result: {
      ok: true,
      value: { sessionId: SID, approvalId: 'approval-1', outcome },
    },
  }
}

describe('ApprovalPanel', () => {
  it('renders the three ordered decisions and sends the remembered outcome', () => {
    const { wait, respond } = approval(true)
    renderPanel(wait)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([
      zh['approval.allowOnce'],
      zh['approval.allowAndRemember'],
      zh['approval.reject'],
    ])

    fireEvent.click(screen.getByRole('button', { name: zh['approval.allowAndRemember'] }))
    expect(respond).toHaveBeenCalledWith(decisionEnvelope('allowed-and-remembered'))
    expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
  })

  it('keeps non-rememberable requests to allow-once and reject', () => {
    const { wait, respond } = approval(false)
    renderPanel(wait)

    expect(screen.queryByRole('button', { name: zh['approval.allowAndRemember'] })).toBeNull()
    const buttons = screen.getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual([
      zh['approval.allowOnce'],
      zh['approval.reject'],
    ])

    fireEvent.click(screen.getByRole('button', { name: zh['approval.allowOnce'] }))
    expect(respond).toHaveBeenCalledWith(decisionEnvelope('allowed-once'))
  })

  it('re-enables every decision when the response is rejected', async () => {
    const { wait, respond } = approval(
      true,
      vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: false, reason: 'bad-response' })),
    )
    renderPanel(wait)

    fireEvent.click(screen.getByRole('button', { name: zh['approval.allowAndRemember'] }))
    expect(screen.getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)

    await waitFor(() => {
      expect(screen.getAllByRole('button').every(button => !button.hasAttribute('disabled'))).toBe(true)
    })
    fireEvent.click(screen.getByRole('button', { name: zh['approval.allowAndRemember'] }))
    expect(respond).toHaveBeenCalledTimes(2)
  })
})
