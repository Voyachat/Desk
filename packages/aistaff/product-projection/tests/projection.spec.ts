import { Context } from '@deepseek-ai/cordis'
import {
  ApprovalId,
  EmployeeId,
} from '@deepseek-ai/dsh-aistaff-product-contracts'
import { describe, expect, it } from 'vitest'
import ProductProjectionService, { projectProductEvents } from '../src/index.ts'

const employee = {
  id: EmployeeId('local-assistant'),
  name: '本地助理',
  role: '本地基础问题处理',
  status: 'ready' as const,
  capabilities: ['local-task'],
}

async function boot(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  const fiber = ctx.plugin(ProductProjectionService, {
    employees: [employee],
    defaultApprovalRisk: 'medium',
  })
  await fiber
  return { ctx, fiber }
}

describe('ProductProjectionService', () => {
  it('creates a queryable task and pending approval in one event', async () => {
    const { ctx } = await boot()
    const seen: string[] = []
    const dispose = ctx.aistaffProduct.subscribe(event => seen.push(event.type))

    const created = await ctx.aistaffProduct.createTask({
      employeeId: employee.id,
      title: '整理发布说明',
    })
    const snapshot = await ctx.aistaffProduct.getSnapshot()

    expect(created).toMatchObject({ ok: true, value: { title: '整理发布说明', status: 'needs_approval' } })
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        tasks: [{ title: '整理发布说明', status: 'needs_approval' }],
        approvals: [{ summary: '允许本地助理执行任务“整理发布说明”', decision: null }],
      },
    })
    expect(seen).toEqual(['task.created'])
    dispose()
  })

  it('commits an approval response exactly once', async () => {
    const { ctx } = await boot()
    await ctx.aistaffProduct.createTask({
      employeeId: employee.id,
      title: '生成本地报告',
    })
    const baseline = await ctx.aistaffProduct.getSnapshot()
    if (!baseline.ok) throw new Error(baseline.error.message)
    const approval = baseline.value.approvals[0]
    if (approval === undefined) throw new Error('expected one approval')

    const first = await ctx.aistaffProduct.respondApproval({
      approvalId: approval.id,
      decision: 'approve',
    })
    const afterFirst = ctx.aistaffProduct.eventHistory()
    const second = await ctx.aistaffProduct.respondApproval({
      approvalId: approval.id,
      decision: 'reject',
    })

    expect(first).toMatchObject({ ok: true, value: { decision: 'approve', status: 'approved' } })
    expect(second).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: `Approval ${JSON.stringify(approval.id)} has already been decided.`,
        retryable: false,
      },
    })
    expect(ctx.aistaffProduct.eventHistory()).toHaveLength(afterFirst.length)
    const snapshot = await ctx.aistaffProduct.getSnapshot()
    expect(snapshot).toMatchObject({
      ok: true,
      value: {
        tasks: [{ status: 'approved' }],
        approvals: [{ decision: 'approve' }],
        receipts: [{ decision: 'approve', status: 'approved' }],
      },
    })
  })

  it('returns explicit failures for unknown employees and approvals', async () => {
    const { ctx } = await boot()

    await expect(ctx.aistaffProduct.createTask({
      employeeId: EmployeeId('missing'),
      title: '不会创建',
    })).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    await expect(ctx.aistaffProduct.respondApproval({
      approvalId: ApprovalId('missing'),
      decision: 'approve',
    })).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })

    expect(ctx.aistaffProduct.eventHistory()).toHaveLength(1)
  })

  it('replays event history to the same snapshot', async () => {
    const { ctx } = await boot()
    await ctx.aistaffProduct.createTask({
      employeeId: employee.id,
      title: '验证确定性重放',
    })
    const before = await ctx.aistaffProduct.getSnapshot()
    if (!before.ok) throw new Error(before.error.message)
    const approval = before.value.approvals[0]
    if (approval === undefined) throw new Error('expected one approval')
    await ctx.aistaffProduct.respondApproval({ approvalId: approval.id, decision: 'reject' })

    const live = await ctx.aistaffProduct.getSnapshot()
    if (!live.ok) throw new Error(live.error.message)
    expect(projectProductEvents(ctx.aistaffProduct.eventHistory())).toEqual(live.value)
  })

  it('fails loudly when the explicit employee catalog is empty', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(ProductProjectionService, {
      employees: [],
      defaultApprovalRisk: 'medium',
    }))
      .rejects.toThrow(/employees|at least one configured employee/)
  })

  it('rejects tasks for an unavailable employee at the Host boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(ProductProjectionService, {
      employees: [{ ...employee, status: 'offline' }],
      defaultApprovalRisk: 'low',
    })

    await expect(ctx.aistaffProduct.createTask({
      employeeId: employee.id,
      title: '不应执行',
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', retryable: true },
    })
  })
})
