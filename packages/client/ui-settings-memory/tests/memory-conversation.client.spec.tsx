// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryId } from '@voyaseek-ai/dsh-agent-memory'
import {
  MemoryMaintenanceRow, MemoryRecallAction, memoryMaintenanceDefinition,
} from '../src/client/MemoryConversation.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const entry = {
  id: 'memory-1', kind: 'preference' as const, key: 'drink', title: '验证饮料',
  content: '用户的验证饮料是正山小种。', keywords: ['饮料'], confidence: 0.9,
  createdAt: 1, updatedAt: 2, source: { sessionId: 'source', turn: 1, mode: 'automatic' as const },
}

const state = {
  status: 'ready' as const, error: null, writable: true, enabled: true,
  maxEntries: 2_000, pendingCount: 0, failedCount: 0, entries: [entry],
}

describe('memory conversation presentation', () => {
  it('projects the durable commit and edits its exact memory from the low-emphasis row', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const controller = { load: vi.fn().mockResolvedValue(undefined), update }
    const useSnapshot = (selector: (value: typeof state) => unknown): unknown => selector(state)
    const props = {
      node: { data: {
        seq: 9, time: 10, turn: 1, status: 'changed',
        changes: [{ action: 'created', id: MemoryId('memory-1'), kind: 'preference', title: '验证饮料' }],
      } },
      controller,
      useSnapshot,
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as React.ComponentProps<typeof MemoryMaintenanceRow>
    render(<MemoryMaintenanceRow {...props} />)

    expect(screen.getByText('已更新长期记忆')).toBeTruthy()
    expect(screen.getByText('新增 1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '编辑记忆' }))
    expect(await screen.findByRole('dialog', { name: '编辑长期记忆' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '验证饮品' } })
    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '用户的验证饮料是咖啡。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('memory-1', {
        title: '验证饮品', content: '用户的验证饮料是咖啡。', keywords: ['饮料'],
      })
    })
  })

  it('matches only committed memory-maintenance events', () => {
    expect(memoryMaintenanceDefinition.match({
      type: 'agent-memory/maintenance', seq: 4, time: 5,
      data: { turn: 1, status: 'changed', changes: [] },
    })).toEqual({ id: '1:4', role: 'start' })
    expect(memoryMaintenanceDefinition.match({
      type: 'agent-memory/maintenance', seq: 5, time: 6,
      data: { turn: 1, status: 'unchanged', changes: [] },
    })).toBeNull()
    expect(memoryMaintenanceDefinition.match({
      type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'completed' } },
    })).toBeNull()
  })

  it('edits the exact item named by a recalled context source', async () => {
    const update = vi.fn().mockResolvedValue(true)
    const controller = { load: vi.fn().mockResolvedValue(undefined), update }
    const useSnapshot = (selector: (value: typeof state) => unknown): unknown => selector(state)
    render(<MemoryRecallAction {...{
      source: {
        kind: 'agent-memory', form: 'recall',
        items: [{ id: 'memory-1', kind: 'preference', title: '验证饮料' }],
      },
      controller,
      useSnapshot,
      t: (key: keyof typeof zh) => zh[key],
    } as unknown as React.ComponentProps<typeof MemoryRecallAction>} />)

    fireEvent.click(screen.getByRole('button', { name: '编辑记忆' }))
    expect(await screen.findByRole('dialog', { name: '编辑长期记忆' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '用户的验证饮料是咖啡。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('memory-1', {
        title: '验证饮料', content: '用户的验证饮料是咖啡。', keywords: ['饮料'],
      })
    })
  })
})
