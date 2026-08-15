// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { AistaffFooterAction, type AistaffFooterActionProps } from '../src/client/AistaffFooterAction.tsx'
import { AistaffWorkbench, type AistaffWorkbenchInjected, type AistaffWorkbenchProps } from '../src/client/AistaffWorkbench.tsx'
import { apply, inject } from '../src/client/index.ts'
import { createMemoryAistaffClientPort, createMemoryProjection } from '../src/client/memory-port.ts'
import type { createAistaffProductStore } from '../src/client/store.ts'

afterEach(cleanup)

type ProductStore = ReturnType<ReturnType<typeof createAistaffProductStore>['create']>

function bindStore(store: ProductStore): SnapshotSelectorHook<ReturnType<ProductStore['getSnapshot']>> {
  return selector => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('aistaffProductPort', createMemoryAistaffClientPort(createMemoryProjection()))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar': { kind: 'single', scope: 'root' },
      'conversation': { kind: 'single', scope: 'session-maybe' },
      'details': { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots }
}

describe('AI employee Client product', () => {
  it('registers only additive seats with one shared store and removes both entries on teardown', async () => {
    const { ctx, slots } = await bench()
    expect(inject).toEqual(['slots', 'aistaffProductPort'])
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const footer = slots.entries('sidebar.footer.action')[0]!
    const overlay = slots.entries('shell.overlay')[0]!
    expect(footer.options).toMatchObject({ id: 'aistaff-client-product', order: 10 })
    expect(overlay.options).toMatchObject({ id: 'aistaff-client-product', order: 10 })
    expect(footer.store).toBe(overlay.store)
    expect(slots.entries('sidebar')).toHaveLength(1)
    expect(slots.entries('conversation')).toHaveLength(0)
    expect(slots.entries('details')).toHaveLength(0)

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.entries('shell.overlay')).toHaveLength(0)
    expect(slots.spec('sidebar.footer.action')).toEqual({ kind: 'list', scope: 'root' })
    expect(slots.spec('shell.overlay')).toEqual({ kind: 'list', scope: 'root' })
  })

  it('renders wide and rail entries and drives open, create, approve, reject, receipt, and close behavior', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const footerEntry = slots.entries('sidebar.footer.action')[0]!
    const overlayEntry = slots.entries('shell.overlay')[0]!
    const handle = footerEntry.store as ReturnType<typeof createAistaffProductStore>
    const store = handle.create()
    const useStore = bindStore(store)
    const injected = (overlayEntry.inject as unknown as (
      actions: ProductStore['actions'],
    ) => AistaffWorkbenchInjected)(store.actions)
    const standing = {
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
    }
    const footerProps = {
      ...standing,
      wide: true,
      useStore,
      actions: store.actions,
    } satisfies AistaffFooterActionProps
    const workbenchProps = {
      ...standing,
      useStore,
      actions: store.actions,
      ...injected,
    } satisfies AistaffWorkbenchProps

    const view = render(
      <>
        <AistaffFooterAction {...footerProps} />
        <AistaffWorkbench {...workbenchProps} />
      </>,
    )
    expect(screen.getByText('AI 员工')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开 AI 员工工作台' }))
    expect(screen.getByRole('dialog', { name: 'AI 员工' })).toBeDefined()
    await waitFor(() => { expect(screen.getByText('整理本周重点事项')).toBeDefined() })
    expect(screen.getByText('低风险')).toBeDefined()

    fireEvent.change(screen.getByLabelText('选择员工'), { target: { value: 'employee-ops' } })
    expect(screen.getByText('任务跟进与整理')).toBeDefined()
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '汇总客户反馈' } })
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }))
    await waitFor(() => { expect(screen.getByText('汇总客户反馈')).toBeDefined() })
    expect(screen.getAllByText('运营助理').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '批准' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: '批准' })[1]!)
    await waitFor(() => { expect(screen.getByText('任务已批准，等待本地执行')).toBeDefined() })
    expect(screen.getAllByText('已批准').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '准备拒绝示例' } })
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }))
    await waitFor(() => { expect(screen.getByText('准备拒绝示例')).toBeDefined() })
    const pendingCards = screen.getAllByRole('article').filter(node => within(node).queryByRole('button', { name: '拒绝' }) !== null)
    fireEvent.click(within(pendingCards.at(-1)!).getByRole('button', { name: '拒绝' }))
    await waitFor(() => { expect(screen.getByText('任务已拒绝')).toBeDefined() })
    expect(screen.getAllByText('已拒绝').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '关闭 AI 员工工作台' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    view.rerender(
      <AistaffFooterAction {...footerProps} wide={false} />,
    )
    const rail = screen.getByRole('button', { name: '打开 AI 员工工作台' })
    expect(rail.getAttribute('title')).toBe('AI 员工')
    expect(within(rail).queryByText('AI 员工')).toBeNull()
    act(() => { store.actions.closeWorkbench() })
  })

  it('renders unavailable employees, high risk, busy feedback, empty states, and unknown task owners', async () => {
    const seed = createMemoryProjection()
    const handle = (await (async () => {
      const { ctx, slots } = await bench()
      await ctx.plugin({ inject: [...inject], apply }).await()
      return slots.entries('shell.overlay')[0]!.store as ReturnType<typeof createAistaffProductStore>
    })())
    const store = handle.create()
    const useStore = bindStore(store)
    const employees = seed.employees.map((value, index) => ({
      ...value,
      status: index === 0 ? 'busy' as const : 'offline' as const,
    }))
    const projection = {
      ...seed,
      employees,
      tasks: [{ ...seed.tasks[0]!, employeeId: 'missing' as never }],
      approvals: [{ ...seed.approvals[0]!, risk: 'high' as const }],
    }
    act(() => {
      store.actions.syncProjection(projection)
      store.actions.openWorkbench()
      store.actions.setDraftTitle('等待中的任务')
      store.actions.setBusy(true)
      store.actions.setError('本地服务繁忙')
    })
    const createTask = vi.fn(async () => true)
    render(<AistaffWorkbench
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useStore={useStore}
      actions={store.actions}
      refreshProjection={vi.fn(async () => true)}
      createTask={createTask}
      respondApproval={vi.fn(async () => true)}
    />)

    expect(screen.getByRole('option', { name: /忙碌/ })).toBeDefined()
    expect(screen.getByRole('option', { name: /离线/ })).toBeDefined()
    expect(screen.getByText('高风险')).toBeDefined()
    expect(screen.getByText('未知员工')).toBeDefined()
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDefined()
    expect(screen.getByRole('alert').textContent).toBe('本地服务繁忙')
    fireEvent.submit(document.querySelector('form')!)
    expect(createTask).not.toHaveBeenCalled()

    act(() => {
      store.actions.setBusy(false)
      store.actions.syncProjection({ ...projection, employees: [], tasks: [], approvals: [], receipts: [] })
    })
    expect(screen.getByLabelText('选择员工').hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('当前没有待审批任务')).toBeDefined()
    expect(screen.getByText('处理审批后，回执会显示在这里')).toBeDefined()
    fireEvent.submit(document.querySelector('form')!)
    expect(createTask).not.toHaveBeenCalled()
  })
})
