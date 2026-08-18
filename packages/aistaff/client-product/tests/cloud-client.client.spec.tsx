// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { useSyncExternalStore } from 'react'
import { Context } from '@voyaseek-ai/cordis'
import {
  ActivityRef,
  EmployeeExperienceObjectLayer,
  EmployeeRef,
  EngagementRef,
  InteractionRef,
  MaterialAccessGrantRef,
  MaterialRef,
  OperationId,
  OwnerRevision,
  ReceiptRef,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperiencePort,
  EmployeeExperienceSnapshot,
  EngagementPage,
  EngagementPageInput,
  EngagementSnapshot,
  EngagementView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  OpenEngagementInput,
  OperationStatusView,
  ProductResult,
  SubmitEmployeeInput,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import { SlotRegistry } from '@voyaseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@voyaseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudAistaffFooterAction } from '../src/cloud-client/CloudAistaffFooterAction.tsx'
import { CloudAistaffWorkbench, type CloudWorkbenchInjected } from '../src/cloud-client/CloudAistaffWorkbench.tsx'
import { createCloudWorkbenchInjected } from '../src/cloud-client/adapter.ts'
import { apply, inject } from '../src/cloud-client/index.ts'
import type { createCloudProductStore } from '../src/cloud-client/store.ts'

afterEach(cleanup)

const REVISION = OwnerRevision('revision-1')

function initialSnapshot(): EmployeeExperienceSnapshot {
  return {
    state: 'ready',
    workforce: {
      revision: REVISION,
      employees: [{
        employee_ref: EmployeeRef('employee-research'),
        display_name: '研究助理',
        role_label: '企业研究分析',
        description: '整理资料并输出安全摘要',
        availability: 'ready',
        capability_labels: ['研究'],
        allowed_actions: { open: { allowed: true } },
      }],
      observed_at: '2026-08-15T00:00:00.000Z',
    },
    engagements: [],
    has_more_engagements: false,
    current_engagement: null,
    view_generation: 0,
    observed_at: '2026-08-15T00:00:00.000Z',
  }
}

class CloudFlowPort extends EmployeeExperienceObjectLayer {
  readonly operationIds: string[] = []

  constructor(ctx: Context) {
    super(ctx, initialSnapshot())
  }

  override async listEngagements(_input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    return { ok: true, value: { items: this.currentSnapshot().engagements, offset: 0, has_more: false, revision: REVISION } }
  }

  override async openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    this.operationIds.push(input.operation_id)
    const engagement: EngagementView = {
      engagement_ref: EngagementRef('engagement-1'),
      employee_ref: input.employee_ref,
      title: '客户反馈研究',
      display_state: 'ready',
      revision: REVISION,
      created_at: '2026-08-15T00:00:01.000Z',
      updated_at: '2026-08-15T00:00:01.000Z',
    }
    this.publishReplacement({
      ...this.currentSnapshot(),
      engagements: [engagement],
      current_engagement: detail(engagement),
      view_generation: this.currentSnapshot().view_generation + 1,
    })
    return { ok: true, value: engagement }
  }

  override async readEngagement(input: { readonly engagement_ref: ReturnType<typeof EngagementRef> }): Promise<ProductResult<EngagementSnapshot>> {
    const current = this.currentSnapshot().current_engagement
    if (current === null || current.engagement.engagement_ref !== input.engagement_ref) {
      return { ok: false, error: { code: 'NOT_FOUND', message: '协作不存在', retryable: false } }
    }
    return { ok: true, value: current }
  }

  override async submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    this.operationIds.push(input.operation_id)
    const current = this.currentSnapshot().current_engagement!
    const activity: ActivityView = {
      activity_ref: ActivityRef('activity-1'),
      engagement_ref: current.engagement.engagement_ref,
      employee_ref: current.engagement.employee_ref,
      display_state: 'waiting_user',
      material_refs: [MaterialRef('material-1')],
      interaction_refs: [
        InteractionRef('approval-1'),
        InteractionRef('input-1'),
        InteractionRef('local-1'),
      ],
      revision: REVISION,
      created_at: '2026-08-15T00:00:02.000Z',
      updated_at: '2026-08-15T00:00:02.000Z',
    }
    this.publishReplacement({
      ...this.currentSnapshot(),
      engagements: [{ ...current.engagement, latest_activity_ref: activity.activity_ref, display_state: 'waiting_user' }],
      current_engagement: {
        ...current,
        activities: [activity],
        materials: [{
          material_ref: MaterialRef('material-1'),
          engagement_ref: current.engagement.engagement_ref,
          activity_ref: activity.activity_ref,
          title: '客户反馈摘要',
          body: { kind: 'text', format: 'markdown', text: '<img src=x onerror=alert(1)>安全摘要' },
          presentation: 'inline',
          state: 'available',
          allowed_actions: { preview: { allowed: true } },
          revision: REVISION,
          created_at: '2026-08-15T00:00:02.000Z',
        }],
        interactions: [{
          kind: 'approval',
          interaction_ref: InteractionRef('approval-1'),
          engagement_ref: current.engagement.engagement_ref,
          activity_ref: activity.activity_ref,
          title: '确认发送摘要',
          summary: '是否允许向团队发送摘要？',
          allowed_outcome_ids: ['reject', 'approve'],
          revision: REVISION,
          risk: 'high',
          owner: 'cloud',
        }, {
          kind: 'input',
          interaction_ref: InteractionRef('input-1'),
          engagement_ref: current.engagement.engagement_ref,
          activity_ref: activity.activity_ref,
          title: '补充说明',
          summary: '请补充客户范围',
          allowed_outcome_ids: ['confirm'],
          revision: REVISION,
          input_schema_ref: 'input.text',
        }, {
          kind: 'local_operation',
          interaction_ref: InteractionRef('local-1'),
          engagement_ref: current.engagement.engagement_ref,
          activity_ref: activity.activity_ref,
          title: '读取本机文件',
          summary: '请求读取本机资料',
          allowed_outcome_ids: ['approve'],
          revision: REVISION,
          capability_ref: 'local.file',
          operation: 'read',
          argument_schema_ref: 'local.file.read',
          arguments: {},
          risk: 'medium',
          effect_class: 'none',
          resource_requirements: [],
          consent_required: true,
        }],
      },
      view_generation: this.currentSnapshot().view_generation + 1,
    })
    return { ok: true, value: activity }
  }

  override async respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    this.operationIds.push(input.operation_id)
    const current = this.currentSnapshot().current_engagement!
    const receipt: EffectReceiptView = {
      receipt_ref: ReceiptRef(`receipt-${input.interaction_ref}`),
      subject_ref: input.interaction_ref,
      status: 'succeeded',
      effect_state: 'none',
      result_material_refs: [MaterialRef('material-1')],
      revision: REVISION,
      recorded_at: '2026-08-15T00:00:03.000Z',
    }
    this.publishReplacement({
      ...this.currentSnapshot(),
      current_engagement: {
        ...current,
        interactions: current.interactions.filter(value => value.interaction_ref !== input.interaction_ref),
        receipts: [...current.receipts, receipt],
      },
      view_generation: this.currentSnapshot().view_generation + 1,
    })
    return { ok: true, value: receipt }
  }

  override async createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    this.operationIds.push(input.operation_id)
    return {
      ok: true,
      value: {
        grant_ref: MaterialAccessGrantRef('grant-1'),
        material_ref: input.material_ref,
        action: input.action,
        content_ref: 'content-1' as MaterialAccessGrant['content_ref'],
        media_type: 'text/plain',
        byte_size: 10,
        content_hash: 'sha256',
        expires_at: '2026-08-15T00:10:00.000Z',
      },
    }
  }

  override async readOperation(input: { readonly operation_id: ReturnType<typeof OperationId> }): Promise<ProductResult<OperationStatusView>> {
    return {
      ok: true,
      value: {
        operation_id: input.operation_id,
        action: 'test',
        state: 'succeeded',
        revision: REVISION,
        updated_at: '2026-08-15T00:00:03.000Z',
      },
    }
  }
}

function detail(engagement: EngagementView): EngagementSnapshot {
  return {
    engagement,
    activities: [],
    materials: [],
    interactions: [],
    receipts: [],
    has_more: false,
    owner_revision: REVISION,
  }
}

type CloudStore = ReturnType<ReturnType<typeof createCloudProductStore>['create']>

function bindStore(store: CloudStore): SnapshotSelectorHook<ReturnType<CloudStore['getSnapshot']>> {
  return selector => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin(CloudFlowPort).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      sidebar: { kind: 'single', scope: 'root' },
      conversation: { kind: 'single', scope: 'session-maybe' },
      details: { kind: 'single', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  slots.register({
    name: 'sidebar',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots, port: ctx.employeeExperience as CloudFlowPort }
}

describe('production Cloud AI employee Client entry', () => {
  it('keeps DSH additive seats and Slot Store free of business projection', async () => {
    const { ctx, slots } = await bench()
    expect(inject).toEqual(['slots', 'employeeExperience'])
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const footer = slots.entries('sidebar.footer.action')[0]!
    const overlay = slots.entries('shell.overlay')[0]!
    expect(footer.options).toMatchObject({ id: 'aistaff-client-product', order: 10 })
    expect(overlay.options).toMatchObject({ id: 'aistaff-client-product', order: 10 })
    expect(footer.store).toBe(overlay.store)
    const store = (footer.store as ReturnType<typeof createCloudProductStore>).create()
    expect(Object.keys(store.getSnapshot()).sort()).toEqual([
      'busy', 'draft', 'error', 'open', 'selectedEmployeeRef', 'selectedEngagementRef',
    ])
    expect(slots.entries('sidebar')).toHaveLength(1)
    expect(slots.entries('conversation')).toHaveLength(0)
    expect(slots.entries('details')).toHaveLength(0)

    await fiber.dispose()
    expect(slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('runs employee → engagement → activity → safe material → interaction → receipt', async () => {
    const { ctx, slots, port } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()
    const footerEntry = slots.entries('sidebar.footer.action')[0]!
    const overlayEntry = slots.entries('shell.overlay')[0]!
    const store = (footerEntry.store as ReturnType<typeof createCloudProductStore>).create()
    const useStore = bindStore(store)
    const injected = (overlayEntry.inject as unknown as (
      actions: CloudStore['actions'],
    ) => CloudWorkbenchInjected)(store.actions)
    const common = {
      useSessions: (() => undefined) as never,
      useWorkspaces: (() => undefined) as never,
    }
    render(<>
      <CloudAistaffFooterAction {...common} wide useStore={useStore} actions={store.actions} />
      <CloudAistaffWorkbench {...common} useStore={useStore} actions={store.actions} {...injected} />
    </>)

    fireEvent.click(screen.getByRole('button', { name: '打开 AI 员工工作台' }))
    await waitFor(() => { expect(screen.getByRole('option', { name: /研究助理 · 可用/ })).toBeDefined() })
    expect(screen.getByText('企业研究分析')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '新建协作' }))
    await waitFor(() => { expect(screen.getByRole('option', { name: '客户反馈研究' })).toBeDefined() })
    fireEvent.change(screen.getByLabelText('给 AI 员工发送消息'), { target: { value: '分析本周客户反馈' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => { expect(screen.getByText('客户反馈摘要')).toBeDefined() })
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>安全摘要/)).toBeDefined()
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('高风险')).toBeDefined()
    expect(screen.getByText('企业审批 · Cloud')).toBeDefined()
    expect(screen.getByText('当前 Cloud-only 模式不允许执行本机操作。')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    await waitFor(() => { expect(screen.getByText('已完成')).toBeDefined() })
    expect(port.operationIds).toHaveLength(3)
    expect(new Set(port.operationIds).size).toBe(3)
  })

  it('reconciles UNKNOWN_OUTCOME with the original operation id and never generates another', async () => {
    const operationId = OperationId('operation-fixed')
    const readOperation = vi.fn(async (input: { readonly operation_id: ReturnType<typeof OperationId> }) => ({
      ok: true as const,
      value: {
        operation_id: input.operation_id,
        action: 'submit',
        state: 'pending' as const,
        revision: REVISION,
        updated_at: '2026-08-15T00:00:00.000Z',
      },
    }))
    const port = {
      submitInput: vi.fn(async (input: SubmitEmployeeInput) => ({
        ok: false as const,
        error: {
          code: 'UNKNOWN_OUTCOME' as const,
          message: '结果未知',
          retryable: false,
          operation_id: input.operation_id,
        },
      })),
      readOperation,
    } as unknown as EmployeeExperiencePort
    const store = (await import('../src/cloud-client/store.ts')).createCloudProductStore().create()
    const createId = vi.fn(() => operationId)
    const injected = createCloudWorkbenchInjected(port, {} as never, store.actions, createId)

    expect(await injected.submitText(EngagementRef('engagement-1'), 'text', REVISION)).toBe(false)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(readOperation).toHaveBeenCalledWith({ operation_id: operationId })
    expect(store.getSnapshot().error).toBe('操作结果仍在确认中，请稍后查看。')
  })

  it('replays a thrown submit only with its original id after authoritative NOT_FOUND', async () => {
    const operationId = OperationId('submit-original')
    const submitInput = vi.fn(async (input: SubmitEmployeeInput) => {
      if (submitInput.mock.calls.length === 1) throw new Error('snapshot refresh failed after Host commit')
      return { ok: true as const, value: {} as ActivityView, operation_id: input.operation_id }
    })
    const readOperation = vi.fn(async (input: { readonly operation_id: ReturnType<typeof OperationId> }) => {
      if (readOperation.mock.calls.length === 1) {
        return {
          ok: true as const,
          value: {
            operation_id: input.operation_id,
            action: 'submitInput',
            state: 'pending' as const,
            revision: REVISION,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        }
      }
      return {
        ok: false as const,
        error: { code: 'NOT_FOUND' as const, message: '尚未登记', retryable: false },
      }
    })
    const port = { submitInput, readOperation } as unknown as EmployeeExperiencePort
    const store = (await import('../src/cloud-client/store.ts')).createCloudProductStore().create()
    const createId = vi.fn(() => operationId)
    const injected = createCloudWorkbenchInjected(port, {} as never, store.actions, createId)

    expect(await injected.submitText(EngagementRef('engagement-1'), '原始文本', REVISION)).toBe(false)
    expect(await injected.submitText(EngagementRef('engagement-1'), '原始文本', REVISION)).toBe(true)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(readOperation).toHaveBeenCalledTimes(2)
    expect(submitInput).toHaveBeenCalledTimes(2)
    expect(submitInput.mock.calls.map(([input]) => input.operation_id)).toEqual([operationId, operationId])
    expect(submitInput.mock.calls[1]?.[0]).toMatchObject({
      engagement_ref: EngagementRef('engagement-1'),
      parts: [{ kind: 'text', text: '原始文本' }],
      expected_revision: REVISION,
    })
  })

  it('queries a thrown interaction response to terminal state without a second mutation id', async () => {
    const operationId = OperationId('respond-original')
    const respondInteraction = vi.fn(async () => {
      throw new Error('snapshot refresh failed after Host commit')
    })
    const readOperation = vi.fn(async (input: { readonly operation_id: ReturnType<typeof OperationId> }) => ({
      ok: true as const,
      value: {
        operation_id: input.operation_id,
        action: 'respondInteraction',
        state: readOperation.mock.calls.length === 1 ? 'unknown' as const : 'succeeded' as const,
        revision: REVISION,
        updated_at: '2026-08-15T00:00:00.000Z',
      },
    }))
    const port = { respondInteraction, readOperation } as unknown as EmployeeExperiencePort
    const store = (await import('../src/cloud-client/store.ts')).createCloudProductStore().create()
    const createId = vi.fn(() => operationId)
    const injected = createCloudWorkbenchInjected(port, {} as never, store.actions, createId)

    expect(await injected.respondInteraction(InteractionRef('approval-1'), 'approve', REVISION)).toBe(false)
    expect(await injected.respondInteraction(InteractionRef('approval-1'), 'approve', REVISION)).toBe(true)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(respondInteraction).toHaveBeenCalledTimes(1)
    expect(readOperation.mock.calls.map(([input]) => input.operation_id)).toEqual([operationId, operationId])
  })

  it('keeps the production entry free of Fixture imports', async () => {
    const files = ['index.ts', 'adapter.ts', 'store.ts', 'external-store.ts', 'CloudAistaffWorkbench.tsx', 'CloudAistaffFooterAction.tsx']
    for (const file of files) {
      const source = await readFile(resolve(process.cwd(), 'packages/aistaff/client-product/src/cloud-client', file), 'utf8')
      expect(source).not.toMatch(/aistaff-product-(?:contracts|remote)|memory-port|createMemory/)
    }
  })
})
