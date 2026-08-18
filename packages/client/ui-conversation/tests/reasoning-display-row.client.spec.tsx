// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@voyaseek-ai/dsh-client-web-react'
import {
  createSnapshotStore, type SessionListState, type WorkspaceListState,
} from '@voyaseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@voyaseek-ai/dsh-client-test-runtime'
import { ReasoningDisplayRow } from '../src/client/settings/ReasoningDisplayRow.tsx'
import type { ReasoningDisplayRowProps } from '../src/client/settings/ReasoningDisplayRow.tsx'
import { ConversationDisplayPolicy } from '../src/client/chat/display-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mount() {
  const policy = new ConversationDisplayPolicy()
  const setShowReasoning = vi.fn((show: boolean) => { policy.setShowReasoning(show) })
  const props: ReasoningDisplayRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useShowReasoning: bindSnapshotSelector(policy.showReasoning),
    setShowReasoning,
    t: makeTranslate(en),
  }
  render(<ReasoningDisplayRow {...props} />)
  return { policy, setShowReasoning }
}

describe('ReasoningDisplayRow', () => {
  it('explains the inline mode and shows Fold into activity by default', () => {
    mount()
    expect(screen.getByText('Reasoning display')).toBeDefined()
    expect(screen.getByText('Inline shows each thinking step as its own row, expanded while it streams')).toBeDefined()
    expect(screen.getByRole('button', { name: /Fold into activity/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Inline rows, follows later preference changes, and closes outside', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: /Fold into activity/ })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inline rows' }))
    expect(b.setShowReasoning).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: /Inline rows/ })).toBeDefined()

    act(() => { b.policy.setShowReasoning(false) })
    const foldedTrigger = screen.getByRole('button', { name: /Fold into activity/ })
    fireEvent.click(foldedTrigger)
    expect(screen.getByRole('menuitem', { name: 'Inline rows' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Inline rows' })).toBeNull()
  })
})
