import { Context } from '@voyaseek-ai/cordis'
import {
  ActivityRef,
  ContentRef,
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
  EmployeeExperienceObservation,
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
  ProductError,
  ProductResult,
  SubmitEmployeeInput,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import TypertGatewayService from '@voyaseek-ai/dsh-api-gateway'
import type { RemoteResult } from '@voyaseek-ai/dsh-typert-protocol'
import TypertRegistry from '@voyaseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import EmployeeExperienceRemoteService from '../src/index.ts'
import {
  EmployeeExperienceRefreshProductError,
  EmployeeExperienceRemoteClientPort,
  EmployeeExperienceRemoteError,
  EmployeeExperienceReplacementError,
  type EmployeeExperienceRemoteNamespace,
} from '../src/client/index.ts'

const employeeRef = EmployeeRef('employee-1')
const engagementRef = EngagementRef('engagement-1')
const activityRef = ActivityRef('activity-1')
const interactionRef = InteractionRef('interaction-1')
const materialRef = MaterialRef('material-1')
const operationId = OperationId('operation-1')

function snapshot(generation: number, displayName = '数据分析员工'): EmployeeExperienceSnapshot {
  const revision = OwnerRevision(`revision-${String(generation)}`)
  const engagement: EngagementView = {
    engagement_ref: engagementRef,
    employee_ref: employeeRef,
    title: '经营分析',
    display_state: 'ready',
    revision,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
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
      observed_at: '2026-08-15T00:00:00.000Z',
    },
    engagements: [engagement],
    has_more_engagements: false,
    current_engagement: null,
    view_generation: generation,
    observed_at: '2026-08-15T00:00:00.000Z',
  }
}

const loadingSnapshot: EmployeeExperienceSnapshot = {
  state: 'loading',
  workforce: null,
  engagements: [],
  has_more_engagements: false,
  current_engagement: null,
  view_generation: 0,
}

const engagement: EngagementView = snapshot(1).engagements[0]!
const activity: ActivityView = {
  activity_ref: activityRef,
  engagement_ref: engagementRef,
  employee_ref: employeeRef,
  display_state: 'queued',
  material_refs: [],
  interaction_refs: [],
  revision: OwnerRevision('revision-1'),
  created_at: '2026-08-15T00:00:00.000Z',
  updated_at: '2026-08-15T00:00:00.000Z',
}
const engagementSnapshot: EngagementSnapshot = {
  engagement,
  activities: [activity],
  materials: [],
  interactions: [],
  receipts: [],
  has_more: false,
  owner_revision: OwnerRevision('revision-1'),
}

function crossRemoteSnapshot(generation: number, settled: boolean): EmployeeExperienceSnapshot {
  const base = snapshot(generation)
  const revision = OwnerRevision(`revision-${String(generation)}`)
  const currentEngagement = base.engagements[0]!
  return {
    ...base,
    current_engagement: {
      engagement: currentEngagement,
      activities: [{
        ...activity,
        display_state: settled ? 'succeeded' : 'waiting_user',
        material_refs: settled ? [materialRef] : [],
        interaction_refs: settled ? [] : [interactionRef],
        revision,
      }],
      materials: settled ? [{
        material_ref: materialRef,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '本机目录结果',
        body: { kind: 'text', format: 'plain_text', text: 'Cloud canonical projection' },
        presentation: 'inline',
        state: 'available',
        allowed_actions: {},
        revision,
        created_at: '2026-08-15T00:00:01.000Z',
      }] : [],
      interactions: settled ? [] : [{
        kind: 'approval',
        interaction_ref: interactionRef,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '允许本机读取',
        summary: '等待本机授权。',
        allowed_outcome_ids: ['reject', 'approve'],
        revision,
        risk: 'medium',
        owner: 'cloud',
      }],
      receipts: [],
      has_more: false,
      owner_revision: revision,
    },
  }
}
const receipt: EffectReceiptView = {
  receipt_ref: ReceiptRef('receipt-1'),
  subject_ref: interactionRef,
  status: 'accepted',
  effect_state: 'none',
  result_material_refs: [],
  revision: OwnerRevision('revision-1'),
  recorded_at: '2026-08-15T00:00:00.000Z',
}
const grant: MaterialAccessGrant = {
  grant_ref: MaterialAccessGrantRef('grant-1'),
  material_ref: materialRef,
  action: 'preview',
  content_ref: ContentRef('content-1'),
  media_type: 'text/plain',
  byte_size: 2,
  content_hash: 'sha256:01',
  expires_at: '2026-08-15T00:05:00.000Z',
}
const operation: OperationStatusView = {
  operation_id: operationId,
  action: 'openEngagement',
  subject_ref: engagementRef,
  state: 'accepted',
  revision: OwnerRevision('revision-1'),
  updated_at: '2026-08-15T00:00:00.000Z',
}

function productError(): ProductError {
  return { code: 'UNAVAILABLE', message: '员工服务暂时不可用。', retryable: true }
}

class HostExperience extends EmployeeExperienceObjectLayer {
  activeTemporaryObservers = 0
  readonly calls: Array<{ method: string; input: unknown }> = []

  constructor(ctx: Context) {
    super(ctx, snapshot(1))
  }

  override observe(listener: (value: EmployeeExperienceSnapshot) => void): EmployeeExperienceObservation {
    const observation = super.observe(listener)
    this.activeTemporaryObservers += 1
    let active = true
    return {
      snapshot: observation.snapshot,
      dispose: () => {
        if (!active) return
        active = false
        this.activeTemporaryObservers -= 1
        observation.dispose()
      },
    }
  }

  override async listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    this.calls.push({ method: 'listEngagements', input })
    return {
      ok: true,
      value: { items: [engagement], offset: input.offset, has_more: false, revision: OwnerRevision('revision-1') },
    }
  }

  override async openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    this.calls.push({ method: 'openEngagement', input })
    return { ok: true, value: engagement }
  }

  override async readEngagement(input: { readonly engagement_ref: typeof engagementRef }): Promise<ProductResult<EngagementSnapshot>> {
    this.calls.push({ method: 'readEngagement', input })
    return { ok: true, value: engagementSnapshot }
  }

  override async submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    this.calls.push({ method: 'submitInput', input })
    return { ok: true, value: activity }
  }

  override async respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    this.calls.push({ method: 'respondInteraction', input })
    return { ok: true, value: receipt }
  }

  override async createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    this.calls.push({ method: 'createMaterialAccess', input })
    return { ok: true, value: grant }
  }

  override async readOperation(input: { readonly operation_id: typeof operationId }): Promise<ProductResult<OperationStatusView>> {
    this.calls.push({ method: 'readOperation', input })
    return { ok: true, value: operation }
  }
}

function carrier<T>(result: ProductResult<T>): RemoteResult<ProductResult<T>> {
  return { ok: true, value: result }
}

class FakeRemote implements EmployeeExperienceRemoteNamespace {
  private lastSnapshot: EmployeeExperienceSnapshot

  constructor(private readonly snapshots: EmployeeExperienceSnapshot[]) {
    this.lastSnapshot = snapshots.at(-1) ?? loadingSnapshot
  }

  readonly getSnapshot = vi.fn<EmployeeExperienceRemoteNamespace['getSnapshot']>(async () => {
    this.lastSnapshot = this.snapshots.shift() ?? this.lastSnapshot
    return carrier({ ok: true, value: this.lastSnapshot })
  })

  readonly listEngagements = vi.fn<EmployeeExperienceRemoteNamespace['listEngagements']>(async input => carrier({
    ok: true,
    value: { items: [engagement], offset: input.offset, has_more: false, revision: OwnerRevision('revision-1') },
  }))

  readonly openEngagement = vi.fn<EmployeeExperienceRemoteNamespace['openEngagement']>(async () =>
    carrier({ ok: true, value: engagement }))

  readonly readEngagement = vi.fn<EmployeeExperienceRemoteNamespace['readEngagement']>(async () =>
    carrier({ ok: true, value: engagementSnapshot }))

  readonly submitInput = vi.fn<EmployeeExperienceRemoteNamespace['submitInput']>(async () =>
    carrier({ ok: true, value: activity }))

  readonly respondInteraction = vi.fn<EmployeeExperienceRemoteNamespace['respondInteraction']>(async () =>
    carrier({ ok: true, value: receipt }))

  readonly createMaterialAccess = vi.fn<EmployeeExperienceRemoteNamespace['createMaterialAccess']>(async () =>
    carrier({ ok: true, value: grant }))

  readonly readOperation = vi.fn<EmployeeExperienceRemoteNamespace['readOperation']>(async () =>
    carrier({ ok: true, value: operation }))
}

describe('EmployeeExperienceRemoteService', () => {
  it('invokes every strict method through the real Gateway and disposes the atomic snapshot observer', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    const experience = new HostExperience(ctx)
    await ctx.plugin(EmployeeExperienceRemoteService)

    const openInput: OpenEngagementInput = { operation_id: operationId, employee_ref: employeeRef, title: '经营分析' }
    const submitInput: SubmitEmployeeInput = {
      operation_id: operationId,
      engagement_ref: engagementRef,
      parts: [{ kind: 'text', text: '分析经营数据' }],
      expected_revision: OwnerRevision('revision-1'),
    }
    const responseInput: InteractionResponseInput = {
      operation_id: operationId,
      interaction_ref: interactionRef,
      outcome_id: 'approve',
      expected_revision: OwnerRevision('revision-1'),
    }
    const materialInput: MaterialAccessInput = {
      operation_id: operationId,
      material_ref: materialRef,
      action: 'preview',
      purpose: '在工作区预览',
      expected_revision: OwnerRevision('revision-1'),
    }

    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'getSnapshot', args: {},
    })).resolves.toMatchObject({ ok: true, value: { view_generation: 1 } })
    expect(experience.activeTemporaryObservers).toBe(0)
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'listEngagements', args: { input: { offset: 0, limit: 20 } },
    })).resolves.toMatchObject({ ok: true, value: { items: [{ engagement_ref: engagementRef }] } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'openEngagement', args: { input: openInput },
    })).resolves.toMatchObject({ ok: true, value: { engagement_ref: engagementRef } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'readEngagement', args: { input: { engagement_ref: engagementRef } },
    })).resolves.toMatchObject({ ok: true, value: { engagement: { engagement_ref: engagementRef } } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'submitInput', args: { input: submitInput },
    })).resolves.toMatchObject({ ok: true, value: { activity_ref: activityRef } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'respondInteraction', args: { input: responseInput },
    })).resolves.toMatchObject({ ok: true, value: { receipt_ref: receipt.receipt_ref } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'createMaterialAccess', args: { input: materialInput },
    })).resolves.toMatchObject({ ok: true, value: { grant_ref: grant.grant_ref } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'employeeExperience', method: 'readOperation', args: { input: { operation_id: operationId } },
    })).resolves.toMatchObject({ ok: true, value: { operation_id: operationId } })

    expect(experience.calls).toEqual([
      { method: 'listEngagements', input: { offset: 0, limit: 20 } },
      { method: 'openEngagement', input: openInput },
      { method: 'readEngagement', input: { engagement_ref: engagementRef } },
      { method: 'submitInput', input: submitInput },
      { method: 'respondInteraction', input: responseInput },
      { method: 'createMaterialAccess', input: materialInput },
      { method: 'readOperation', input: { operation_id: operationId } },
    ])
  })
})

describe('EmployeeExperienceRemoteClientPort', () => {
  it('registers only after strict initial refresh and publishes full replacements after successful mutations', async () => {
    let settle: ((value: RemoteResult<ProductResult<EmployeeExperienceSnapshot>>) => void) | undefined
    const pending = new Promise<RemoteResult<ProductResult<EmployeeExperienceSnapshot>>>(resolve => { settle = resolve })
    const remote = new FakeRemote([snapshot(2)])
    remote.getSnapshot.mockImplementationOnce(() => pending)
    const ctx = new Context()

    const creating = EmployeeExperienceRemoteClientPort.create(ctx, remote)
    expect(ctx.get('employeeExperience')).toBeUndefined()
    settle?.(carrier({ ok: true, value: snapshot(1) }))
    const port = await creating
    expect(ctx.get('employeeExperience')).toBeInstanceOf(EmployeeExperienceRemoteClientPort)

    const observed = vi.fn()
    const observation = port.observe(observed)
    const input: OpenEngagementInput = { operation_id: operationId, employee_ref: employeeRef, title: '经营分析' }
    await expect(port.openEngagement(input)).resolves.toEqual({ ok: true, value: engagement })

    expect(remote.openEngagement).toHaveBeenCalledWith(input)
    expect(remote.openEngagement.mock.calls[0]?.[0].operation_id).toBe(operationId)
    expect(observation.snapshot.view_generation).toBe(1)
    expect(observed).toHaveBeenCalledWith(expect.objectContaining({ view_generation: 2 }))
    observation.dispose()
  })

  it('does not publish equal content at generation zero and rejects divergent or regressing replacements', async () => {
    const stableRemote = new FakeRemote([loadingSnapshot, loadingSnapshot])
    const stable = await EmployeeExperienceRemoteClientPort.create(new Context(), stableRemote)
    const stableListener = vi.fn()
    stable.observe(stableListener)
    await stable.createMaterialAccess({
      operation_id: operationId,
      material_ref: materialRef,
      action: 'preview',
      purpose: '预览',
      expected_revision: OwnerRevision('revision-0'),
    })
    expect(stableListener).not.toHaveBeenCalled()

    const divergentContext = new Context()
    await expect(EmployeeExperienceRemoteClientPort.create(divergentContext, new FakeRemote([snapshot(0)])))
      .rejects.toBeInstanceOf(EmployeeExperienceReplacementError)
    expect(divergentContext.get('employeeExperience')).toBeUndefined()

    const regressing = await EmployeeExperienceRemoteClientPort.create(new Context(), new FakeRemote([
      snapshot(2),
      snapshot(1),
    ]))
    await expect(regressing.submitInput({
      operation_id: operationId,
      engagement_ref: engagementRef,
      parts: [{ kind: 'text', text: '继续' }],
      expected_revision: OwnerRevision('revision-2'),
    })).rejects.toBeInstanceOf(EmployeeExperienceReplacementError)
  })

  it('publishes the complete canonical replacement after an external Local sink update', async () => {
    const initial = crossRemoteSnapshot(1, false)
    const canonical = crossRemoteSnapshot(2, true)
    const remote = new FakeRemote([initial, canonical])
    remote.readEngagement.mockResolvedValueOnce(carrier({ ok: true, value: canonical.current_engagement! }))
    const port = await EmployeeExperienceRemoteClientPort.create(new Context(), remote)
    const observed = vi.fn()
    const observation = port.observe(observed)

    await expect(port.readEngagement({ engagement_ref: engagementRef }))
      .resolves.toEqual({ ok: true, value: canonical.current_engagement })
    expect(remote.getSnapshot).toHaveBeenCalledTimes(2)
    expect(observed).toHaveBeenCalledTimes(1)
    expect(observed).toHaveBeenLastCalledWith(expect.objectContaining({
      view_generation: 2,
      current_engagement: expect.objectContaining({
        activities: [expect.objectContaining({ display_state: 'succeeded', material_refs: [materialRef] })],
        materials: [expect.objectContaining({ material_ref: materialRef })],
        interactions: [],
      }),
    }))
    observation.dispose()
  })

  it('does not publish successful detail data when the full refresh fails', async () => {
    const initial = crossRemoteSnapshot(1, false)
    const canonical = crossRemoteSnapshot(2, true)
    const remote = new FakeRemote([initial])
    remote.readEngagement.mockResolvedValueOnce(carrier({ ok: true, value: canonical.current_engagement! }))
    const port = await EmployeeExperienceRemoteClientPort.create(new Context(), remote)
    const observed = vi.fn()
    const observation = port.observe(observed)
    const failure = productError()
    remote.getSnapshot.mockResolvedValueOnce(carrier({ ok: false, error: failure }))

    await expect(port.readEngagement({ engagement_ref: engagementRef })).rejects.toMatchObject({
      name: 'EmployeeExperienceRefreshProductError',
      productError: failure,
    })
    expect(observed).not.toHaveBeenCalled()
    expect(observation.snapshot).toEqual(initial)
    expect(observation.snapshot.current_engagement?.materials).toEqual([])
    expect(observation.snapshot.current_engagement?.interactions).toHaveLength(1)
    observation.dispose()
  })

  it('keeps ProductError results separate from carrier failures and reconciles the original operation id', async () => {
    const remote = new FakeRemote([snapshot(1)])
    const businessFailure = productError()
    remote.listEngagements.mockResolvedValueOnce(carrier({ ok: false, error: businessFailure }))
    const port = await EmployeeExperienceRemoteClientPort.create(new Context(), remote)

    await expect(port.listEngagements({ offset: 0, limit: 20 })).resolves.toEqual({
      ok: false,
      error: businessFailure,
    })
    remote.listEngagements.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unavailable', message: 'Host unavailable', details: {} },
    })
    await expect(port.listEngagements({ offset: 0, limit: 20 })).rejects.toBeInstanceOf(EmployeeExperienceRemoteError)

    const reconcileInput = { operation_id: operationId }
    await expect(port.readOperation(reconcileInput)).resolves.toEqual({ ok: true, value: operation })
    expect(remote.readOperation).toHaveBeenCalledWith(reconcileInput)
    expect(remote.getSnapshot).toHaveBeenCalledTimes(1)
  })

  it('fails initial registration with the original ProductError category', async () => {
    const remote = new FakeRemote([])
    const failure = productError()
    remote.getSnapshot.mockResolvedValueOnce(carrier({ ok: false, error: failure }))
    const ctx = new Context()

    await expect(EmployeeExperienceRemoteClientPort.create(ctx, remote)).rejects.toMatchObject({
      name: 'EmployeeExperienceRefreshProductError',
      productError: failure,
    })
    await expect(EmployeeExperienceRemoteClientPort.create(new Context(), {
      ...remote,
      getSnapshot: async () => carrier({ ok: false, error: failure }),
    })).rejects.toBeInstanceOf(EmployeeExperienceRefreshProductError)
    expect(ctx.get('employeeExperience')).toBeUndefined()
  })
})
