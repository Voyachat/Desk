import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  ActivityRef,
  EmployeeExperienceObjectLayer,
  EmployeeRef,
  EngagementRef,
  InteractionRef,
  MaterialRef,
  OperationId,
  OwnerRevision,
  ReceiptRef,
} from '../src/index.ts'
import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperienceSnapshot,
  EngagementPage,
  EngagementPageInput,
  EngagementRef as EngagementRefType,
  EngagementSnapshot,
  EngagementView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  OpenEngagementInput,
  OperationId as OperationIdType,
  OperationStatusView,
  ProductError,
  ProductResult,
  SubmitEmployeeInput,
} from '../src/types.ts'

function snapshot(generation: number, displayName = '数据分析员工'): EmployeeExperienceSnapshot {
  const employeeRef = EmployeeRef('employee-1')
  const engagementRef = EngagementRef('engagement-1')
  const activityRef = ActivityRef('activity-1')
  const materialRef = MaterialRef('material-1')
  const interactionRef = InteractionRef('interaction-1')
  const revision = OwnerRevision(`revision-${String(generation)}`)
  const engagement: EngagementView = {
    engagement_ref: engagementRef,
    employee_ref: employeeRef,
    title: '经营分析',
    display_state: 'waiting_user',
    latest_activity_ref: activityRef,
    revision,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:01:00.000Z',
  }
  return {
    state: 'ready',
    workforce: {
      revision,
      employees: [{
        employee_ref: employeeRef,
        display_name: displayName,
        role_label: '分析师',
        availability: 'ready',
        capability_labels: ['分析'],
        allowed_actions: { open: { allowed: true } },
      }],
      observed_at: '2026-08-15T00:01:00.000Z',
    },
    engagements: [engagement],
    has_more_engagements: false,
    current_engagement: {
      engagement,
      activities: [{
        activity_ref: activityRef,
        engagement_ref: engagementRef,
        employee_ref: employeeRef,
        display_state: 'waiting_user',
        material_refs: [materialRef],
        interaction_refs: [interactionRef],
        revision,
        created_at: '2026-08-15T00:00:30.000Z',
        updated_at: '2026-08-15T00:01:00.000Z',
      }],
      materials: [{
        material_ref: materialRef,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '分析摘要',
        body: { kind: 'text', format: 'markdown', text: '结果' },
        presentation: 'inline',
        state: 'available',
        allowed_actions: { preview: { allowed: true } },
        revision,
        created_at: '2026-08-15T00:01:00.000Z',
      }],
      interactions: [{
        kind: 'approval',
        interaction_ref: interactionRef,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '确认发送',
        summary: '是否发送分析摘要？',
        allowed_outcome_ids: ['approve', 'reject'],
        revision,
        risk: 'medium',
        owner: 'cloud',
      }],
      receipts: [{
        receipt_ref: ReceiptRef('receipt-1'),
        subject_ref: 'subject-1',
        status: 'accepted',
        effect_state: 'none',
        result_material_refs: [materialRef],
        revision,
        recorded_at: '2026-08-15T00:01:00.000Z',
      }],
      has_more: false,
      owner_revision: revision,
    },
    view_generation: generation,
    observed_at: '2026-08-15T00:01:00.000Z',
  }
}

class TestEmployeeExperience extends EmployeeExperienceObjectLayer {
  constructor(ctx: Context, initial: EmployeeExperienceSnapshot) {
    super(ctx, initial)
  }

  publish(next: EmployeeExperienceSnapshot): void {
    this.publishReplacement(next)
  }

  override async listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    const current = this.currentSnapshot()
    const items = current.engagements.slice(input.offset, input.offset + input.limit)
    return {
      ok: true,
      value: {
        items,
        offset: input.offset,
        has_more: input.offset + items.length < current.engagements.length,
        revision: current.workforce?.revision ?? OwnerRevision('empty'),
      },
    }
  }

  override async openEngagement(_input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    return { ok: false, error: unavailable() }
  }

  override async readEngagement(_input: { readonly engagement_ref: EngagementRefType }): Promise<ProductResult<EngagementSnapshot>> {
    return { ok: false, error: unavailable() }
  }

  override async submitInput(_input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    return { ok: false, error: unavailable() }
  }

  override async respondInteraction(_input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    return { ok: false, error: unavailable() }
  }

  override async createMaterialAccess(_input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    return { ok: false, error: unavailable() }
  }

  override async readOperation(_input: { readonly operation_id: OperationIdType }): Promise<ProductResult<OperationStatusView>> {
    return { ok: false, error: unavailable() }
  }
}

function unavailable(): ProductError {
  return {
    code: 'UNAVAILABLE',
    message: '员工服务暂时不可用。',
    retryable: true,
    retry_after_ms: 1_000,
    operation_id: OperationId('operation-1'),
  }
}

describe('EmployeeExperienceObjectLayer', () => {
  it('atomically returns the initial immutable snapshot and observes only later replacements', () => {
    const service = new TestEmployeeExperience(new Context(), snapshot(0))
    const observed: EmployeeExperienceSnapshot[] = []

    const observation = service.observe(value => observed.push(value))
    service.publish(snapshot(1, '经营分析员工'))

    expect(observation.snapshot.view_generation).toBe(0)
    expect(observed.map(value => value.view_generation)).toEqual([1])
    expect(observed[0]?.workforce?.employees[0]?.display_name).toBe('经营分析员工')
    observation.dispose()
  })

  it('publishes complete detached deeply frozen replacements', () => {
    const service = new TestEmployeeExperience(new Context(), snapshot(0))
    const source = snapshot(1)
    let replacement: EmployeeExperienceSnapshot | undefined
    service.observe(value => { replacement = value })

    service.publish(source)
    Reflect.set(source.workforce!.employees[0]!, 'display_name', '被外部修改')

    expect(replacement?.workforce?.employees[0]?.display_name).toBe('数据分析员工')
    expect(Object.isFrozen(replacement)).toBe(true)
    expect(Object.isFrozen(replacement?.workforce?.employees)).toBe(true)
    expect(Object.isFrozen(replacement?.current_engagement?.materials[0]?.body)).toBe(true)
  })

  it('contains a failing listener, supports idempotent disposal, and removes caller-owned effects', async () => {
    const ctx = new Context()
    const service = new TestEmployeeExperience(ctx, snapshot(0))
    const logger = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    const surviving = vi.fn()
    service.observe(() => { throw new Error('broken renderer') })
    const disposed = service.observe(surviving)
    disposed.dispose()
    disposed.dispose()
    const caller = ctx.plugin({
      inject: ['employeeExperience'],
      apply(child) {
        child.employeeExperience.observe(surviving)
      },
    })
    await caller.await()
    await caller.dispose()

    service.publish(snapshot(1))

    expect(surviving).not.toHaveBeenCalled()
    expect(logger).toHaveBeenCalledWith('employee experience replacement listener failed')
  })

  it('rejects reused or invalid replacement generations', () => {
    const service = new TestEmployeeExperience(new Context(), snapshot(1))

    expect(() => service.publish(snapshot(1))).toThrow('must be greater than 1')
    expect(() => service.publish(snapshot(Number.NaN))).toThrow('non-negative safe integer')
  })
})

describe('Renderer-safe contract', () => {
  it('keeps opaque identities as distinct JSON strings and errors display-safe', () => {
    const errorResult: ProductResult<never> = { ok: false, error: unavailable() }
    expect(JSON.parse(JSON.stringify({
      employee: EmployeeRef('employee-1'),
      engagement: EngagementRef('engagement-1'),
      activity: ActivityRef('activity-1'),
      material: MaterialRef('material-1'),
      interaction: InteractionRef('interaction-1'),
      receipt: ReceiptRef('receipt-1'),
      operation: OperationId('operation-1'),
    }))).toEqual({
      employee: 'employee-1',
      engagement: 'engagement-1',
      activity: 'activity-1',
      material: 'material-1',
      interaction: 'interaction-1',
      receipt: 'receipt-1',
      operation: 'operation-1',
    })
    expect(errorResult).toEqual({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: '员工服务暂时不可用。',
        retryable: true,
        retry_after_ms: 1_000,
        operation_id: 'operation-1',
      },
    })
  })

  it('does not define transport recovery, credential, location, or engine identities', async () => {
    const typesFile = fileURLToPath(new URL('../src/types.ts', import.meta.url))
    const source = await readFile(typesFile, 'utf8')
    expect(source).not.toMatch(/\b(?:snapshot_ref|stream_ref|resume_cursor|access_token|refresh_token|absolute_path|run_ref|worker_ref|session_ref)\b/)
  })
})
