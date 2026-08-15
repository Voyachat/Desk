import { Context } from '@deepseek-ai/cordis'
import { EmployeeId } from '@deepseek-ai/dsh-aistaff-product-contracts'
import ProductProjectionService from '@deepseek-ai/dsh-aistaff-product-projection'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import AistaffProductRemoteService from '../src/index.ts'
import {
  AistaffProductRemoteError,
  AistaffRemoteClientPort,
  type AistaffProductRemoteNamespace,
} from '../src/client/index.ts'

const employee = {
  id: EmployeeId('local-assistant'),
  name: '本地助理',
  role: '本地基础问题处理',
  status: 'ready' as const,
  capabilities: ['local-task'],
}

async function bootHost(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ProductProjectionService, {
    employees: [employee],
    defaultApprovalRisk: 'medium',
  })
  await ctx.plugin(AistaffProductRemoteService)
  return ctx
}

describe('AistaffProductRemoteService', () => {
  it('delegates reads and mutations to the authoritative Host projection', async () => {
    const ctx = await bootHost()
    expect(ctx.aistaffProductRemote.typertRemote.namespace).toBe('aistaffProduct')

    const baseline = await ctx.aistaffProductRemote.getSnapshot()
    expect(baseline).toMatchObject({ ok: true, value: { revision: 1, employees: [employee] } })

    const created = await ctx.aistaffProductRemote.createTask({
      employeeId: employee.id,
      title: '验证远程主链',
    })
    if (!created.ok) throw new Error(created.error.message)
    const afterCreate = await ctx.aistaffProductRemote.getSnapshot()
    if (!afterCreate.ok) throw new Error(afterCreate.error.message)
    const approval = afterCreate.value.approvals[0]
    if (approval === undefined) throw new Error('expected one pending approval')

    const receipt = await ctx.aistaffProductRemote.respondApproval({
      approvalId: approval.id,
      decision: 'approve',
    })
    expect(receipt).toMatchObject({ ok: true, value: { taskId: created.value.id, status: 'approved' } })
    await expect(ctx.aistaffProductRemote.getSnapshot()).resolves.toMatchObject({
      ok: true,
      value: {
        revision: 3,
        tasks: [{ status: 'approved' }],
        approvals: [{ decision: 'approve' }],
        receipts: [{ status: 'approved' }],
      },
    })
  })

  it('forwards the named Gateway input as the single product request', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    await ctx.plugin(ProductProjectionService, {
      employees: [employee],
      defaultApprovalRisk: 'medium',
    })
    await ctx.plugin(AistaffProductRemoteService)

    const created = await ctx.typertGateway.invoke({
      namespace: 'aistaffProduct',
      method: 'createTask',
      args: {
        input: {
          employeeId: employee.id,
          title: '验证 Gateway 实参',
        },
      },
    })

    expect(created).toMatchObject({
      ok: true,
      value: {
        employeeId: employee.id,
        title: '验证 Gateway 实参',
        status: 'needs_approval',
      },
    })
  })
})

describe('AistaffRemoteClientPort', () => {
  it('unwraps Remote success envelopes and forwards exact inputs', async () => {
    const snapshot = { revision: 0, employees: [], tasks: [], approvals: [], receipts: [] }
    const getSnapshot = vi.fn<AistaffProductRemoteNamespace['getSnapshot']>()
      .mockResolvedValue({ ok: true, value: { ok: true, value: snapshot } })
    const createTask = vi.fn<AistaffProductRemoteNamespace['createTask']>()
      .mockResolvedValue({ ok: true, value: {
        ok: false,
        error: { code: 'NOT_FOUND', message: 'missing employee', retryable: false },
      } })
    const respondApproval = vi.fn<AistaffProductRemoteNamespace['respondApproval']>()
      .mockResolvedValue({ ok: true, value: {
        ok: false,
        error: { code: 'CONFLICT', message: 'already decided', retryable: false },
      } })
    const remote = { getSnapshot, createTask, respondApproval }
    const ctx = new Context()
    const port = new AistaffRemoteClientPort(ctx, remote)
    const createInput = {
      employeeId: employee.id,
      title: '请求',
    }

    await expect(port.getSnapshot()).resolves.toEqual({ ok: true, value: snapshot })
    await expect(port.createTask(createInput)).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(createTask).toHaveBeenCalledWith(createInput)
    await expect(port.respondApproval({
      approvalId: 'approval-1' as Parameters<AistaffProductRemoteNamespace['respondApproval']>[0]['approvalId'],
      decision: 'reject',
    })).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
  })

  it('rejects carrier failures without fabricating a product business error', async () => {
    const failure = {
      ok: false as const,
      error: { code: 'unavailable', message: 'Host unavailable', details: {} },
    }
    const remote: AistaffProductRemoteNamespace = {
      getSnapshot: async () => failure,
      createTask: async () => failure,
      respondApproval: async () => failure,
    }
    const port = new AistaffRemoteClientPort(new Context(), remote)

    await expect(port.getSnapshot()).rejects.toMatchObject({
      name: 'AistaffProductRemoteError',
      code: 'unavailable',
      message: 'Host unavailable',
    })
    await expect(port.getSnapshot()).rejects.toBeInstanceOf(AistaffProductRemoteError)
  })

  it('keeps fixture subscriptions silent', () => {
    const remote = {
      getSnapshot: vi.fn(),
      createTask: vi.fn(),
      respondApproval: vi.fn(),
    } as unknown as AistaffProductRemoteNamespace
    const port = new AistaffRemoteClientPort(new Context(), remote)
    const listener = vi.fn()

    const dispose = port.subscribe(listener)
    dispose()
    expect(listener).not.toHaveBeenCalled()
  })
})
