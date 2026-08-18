import { ApprovalId, EmployeeId } from '@voyaseek-ai/dsh-aistaff-product-contracts'
import type {
  AistaffClientPort,
  ProductProjectionSnapshot,
  Receipt,
} from '@voyaseek-ai/dsh-aistaff-product-contracts'
import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchInjected } from '../src/client/adapter.ts'
import { createMemoryAistaffClientPort, createMemoryProjection } from '../src/client/memory-port.ts'
import { createAistaffProductStore } from '../src/client/store.ts'

describe('memory Aistaff Client Port', () => {
  it('publishes exact task and approval events and enforces failures', async () => {
    const port = createMemoryAistaffClientPort()
    const listener = vi.fn()
    const unsubscribe = port.subscribe(listener)
    const created = await port.createTask({
      employeeId: EmployeeId('employee-research'),
      title: '  新任务  ',
    })
    expect(created).toMatchObject({ ok: true, value: { title: '新任务', status: 'needs_approval' } })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'task.created', revision: 2 }))

    if (!created.ok) throw new Error('expected task creation')
    const snapshot = await port.getSnapshot()
    if (!snapshot.ok) throw new Error('expected snapshot')
    const approval = snapshot.value.approvals.find(value => value.taskId === created.value.id)!
    const receipt = await port.respondApproval({ approvalId: approval.id, decision: 'reject' })
    expect(receipt).toMatchObject({ ok: true, value: { status: 'rejected', decision: 'reject' } })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'approval.responded', revision: 3 }))
    expect(await port.respondApproval({ approvalId: approval.id, decision: 'approve' }))
      .toMatchObject({ ok: false, error: { code: 'CONFLICT', retryable: false } })

    expect(await port.createTask({
      employeeId: EmployeeId('missing'), title: 'x',
    })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await port.createTask({
      employeeId: EmployeeId('employee-research'), title: ' ',
    })).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(await port.respondApproval({ approvalId: ApprovalId('missing'), decision: 'approve' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    unsubscribe()
    await port.createTask({
      employeeId: EmployeeId('employee-research'), title: '静默任务',
    })
    expect(listener).toHaveBeenCalledTimes(2)

    const broken = createMemoryProjection()
    const brokenPort = createMemoryAistaffClientPort({ ...broken, tasks: [] })
    expect(await brokenPort.respondApproval({ approvalId: broken.approvals[0]!.id, decision: 'approve' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND', message: '审批关联的任务不存在' } })
  })

  it('adapts Port failures and refresh results into shared store feedback', async () => {
    const projection = createMemoryProjection()
    const store = createAistaffProductStore(projection).create()
    const task = projection.tasks[0]!
    const approval = projection.approvals[0]!
    const receipt: Receipt = {
      id: 'receipt-test' as Receipt['id'],
      taskId: task.id,
      approvalId: approval.id,
      decision: 'approve',
      status: 'approved',
      summary: 'done',
      recordedAt: task.updatedAt,
    }
    const getSnapshot = vi.fn<() => AistaffClientPort['getSnapshot'] extends () => infer R ? R : never>()
    const createTask = vi.fn<AistaffClientPort['createTask']>()
    const respondApproval = vi.fn<AistaffClientPort['respondApproval']>()
    const port: AistaffClientPort = {
      getSnapshot,
      createTask,
      respondApproval,
      subscribe: () => () => {},
    }
    const injected = createWorkbenchInjected(port, store.actions)
    const createInput = {
      employeeId: projection.employees[0]!.id,
      title: 'test',
    }

    createTask.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CONFLICT', message: '创建失败', retryable: false },
    })
    expect(await injected.createTask(createInput)).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: '创建失败' })

    store.actions.setDraftTitle('保留草稿')
    createTask.mockResolvedValueOnce({ ok: true, value: task })
    getSnapshot.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NOT_FOUND', message: '刷新失败', retryable: false },
    })
    expect(await injected.createTask(createInput)).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: '刷新失败', draftTitle: '保留草稿' })

    createTask.mockResolvedValueOnce({ ok: true, value: task })
    getSnapshot.mockResolvedValueOnce({ ok: true, value: projection })
    expect(await injected.createTask(createInput)).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: null, draftTitle: '' })

    respondApproval.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CONFLICT', message: '审批失败', retryable: false },
    })
    expect(await injected.respondApproval({ approvalId: approval.id, decision: 'approve' })).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: '审批失败' })

    respondApproval.mockResolvedValueOnce({ ok: true, value: receipt })
    getSnapshot.mockResolvedValueOnce({ ok: true, value: projection })
    expect(await injected.respondApproval({ approvalId: approval.id, decision: 'approve' })).toBe(true)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: null })

    getSnapshot.mockRejectedValueOnce(new Error('carrier unavailable'))
    expect(await injected.refreshProjection()).toBe(false)
    expect(store.getSnapshot().error).toBe('无法连接本地服务，请稍后重试')

    createTask.mockRejectedValueOnce(new Error('carrier unavailable'))
    expect(await injected.createTask(createInput)).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: '无法连接本地服务，请稍后重试' })

    respondApproval.mockRejectedValueOnce(new Error('carrier unavailable'))
    expect(await injected.respondApproval({ approvalId: approval.id, decision: 'approve' })).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ busy: false, error: '无法连接本地服务，请稍后重试' })
  })

  it('keeps a valid selection and falls back when projection employees change', () => {
    const projection = createMemoryProjection()
    const empty: ProductProjectionSnapshot = {
      revision: 0,
      employees: [],
      tasks: [],
      approvals: [],
      receipts: [],
    }
    const emptyStore = createAistaffProductStore(empty).create()
    expect(emptyStore.getSnapshot().selectedEmployeeId).toBeNull()

    emptyStore.actions.syncProjection(projection)
    expect(emptyStore.getSnapshot().selectedEmployeeId).toBe(projection.employees[0]!.id)
    emptyStore.actions.selectEmployee(projection.employees[1]!.id)
    emptyStore.actions.syncProjection(projection)
    expect(emptyStore.getSnapshot().selectedEmployeeId).toBe(projection.employees[1]!.id)
    emptyStore.actions.syncProjection(empty)
    expect(emptyStore.getSnapshot().selectedEmployeeId).toBeNull()
  })
})
