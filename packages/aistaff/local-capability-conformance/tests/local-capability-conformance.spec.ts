import { Context } from '@voyaseek-ai/cordis'
import {
  InteractionRef,
  OperationId,
  OwnerRevision,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalCapabilityPort,
  LocalCapabilitySnapshot,
  SelectDirectoryResult,
} from '@voyaseek-ai/dsh-aistaff-local-capability'
import {
  LocalCapabilityCoordinator,
} from '@voyaseek-ai/dsh-aistaff-local-capability'
import {
  SupervisorControlPort,
} from '@voyaseek-ai/dsh-aistaff-supervisor-control'
import type {
  ReadCapabilityRequest,
  ReadCapabilityResult,
  SupervisorGrantRegister,
  SupervisorGrantResult,
  SupervisorGrantRevoke,
  SupervisorHello,
  SupervisorOperationId,
  SupervisorOperationStatus,
  SupervisorReceipt,
  SupervisorReceiptRef,
} from '@voyaseek-ai/dsh-aistaff-supervisor-control/types'
import { InMemorySupervisorControl } from '@voyaseek-ai/dsh-aistaff-supervisor-control/testing'
import { describe, expect, it } from 'vitest'
import * as conformance from '../src/index.ts'

type NonSuccessReceiptStatus = Exclude<SupervisorReceipt['status'], 'succeeded'>
type ControlledOperation = 'register' | 'read' | 'revoke'

const receiptFailures = [
  { status: 'failed', errorCode: 'UNAVAILABLE', operationState: 'failed' },
  { status: 'rejected', errorCode: 'DENIED', operationState: 'rejected' },
  { status: 'unknown', errorCode: 'UNKNOWN_OUTCOME', operationState: 'unknown' },
] as const

class ControlledReceiptSupervisor extends SupervisorControlPort {
  private readonly delegate: InMemorySupervisorControl

  constructor(
    ctx: Context,
    private readonly operation: ControlledOperation,
    private readonly status: NonSuccessReceiptStatus,
    now: () => Date,
  ) {
    super(ctx)
    this.delegate = new InMemorySupervisorControl(new Context(), {
      clock: now,
      maxRequestBytes: 32_768,
      maxResultBytes: 8_192,
      intentResults: {
        'directory/list': {
          kind: 'directory',
          entries: [{ name: '经营数据.csv', kind: 'file', size_bytes: 128 }],
        },
      },
    })
  }

  override hello(): Promise<SupervisorHello> {
    return this.delegate.hello()
  }

  override async registerGrant(input: SupervisorGrantRegister): Promise<SupervisorGrantResult> {
    const result = await this.delegate.registerGrant(input)
    return this.operation === 'register'
      ? { ...result, receipt: changedReceipt(result.receipt, this.status) }
      : result
  }

  override async revokeGrant(input: SupervisorGrantRevoke): Promise<SupervisorReceipt> {
    const receipt = await this.delegate.revokeGrant(input)
    return this.operation === 'revoke' ? changedReceipt(receipt, this.status) : receipt
  }

  override async readCapability(input: ReadCapabilityRequest): Promise<ReadCapabilityResult> {
    const result = await this.delegate.readCapability(input)
    return this.operation === 'read'
      ? { ...result, receipt: changedReceipt(result.receipt, this.status) }
      : result
  }

  override getReceipt(input: { readonly receipt_ref: SupervisorReceiptRef }): Promise<SupervisorReceipt> {
    return this.delegate.getReceipt(input)
  }

  override readOperation(
    input: { readonly operation_id: SupervisorOperationId },
  ): Promise<SupervisorOperationStatus> {
    return this.delegate.readOperation(input)
  }
}

function changedReceipt(
  receipt: SupervisorReceipt,
  status: NonSuccessReceiptStatus,
): SupervisorReceipt {
  return {
    ...receipt,
    status,
    effect_state: status === 'unknown' ? 'unknown' : 'not_applied',
    reason_code: `TEST_${status.toUpperCase()}`,
    receipt_hash: `${receipt.receipt_hash}:${status}`,
  }
}

async function mount(): Promise<{
  readonly ctx: Context
  readonly fiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin(conformance)
  await fiber
  return { ctx, fiber }
}

async function mountControlled(
  operation: ControlledOperation,
  status: NonSuccessReceiptStatus,
): Promise<{
  readonly ctx: Context
  readonly fiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin({
    apply(pluginCtx: Context): void {
      const clock = new conformance.ConformanceClock()
      const interactions = new conformance.ConformanceInteractionResolver(conformance.fixedOperation())
      const directorySelector = new conformance.ConformanceDirectorySelector()
      const resultSink = new conformance.ConformanceResultSink()
      const supervisor = new ControlledReceiptSupervisor(pluginCtx, operation, status, clock.now)
      LocalCapabilityCoordinator.create(pluginCtx, {
        interactions,
        directory_selector: directorySelector,
        result_sink: resultSink,
        supervisor,
        options: {
          grant_lifetime_ms: 60_000,
          max_read_bytes: 4_096,
          read_timeout_ms: 5_000,
          now: clock.now,
        },
      })
    },
  })
  await fiber
  return { ctx, fiber }
}

function snapshot(service: LocalCapabilityPort): LocalCapabilitySnapshot {
  const observation = service.observe(() => {})
  observation.dispose()
  return observation.snapshot
}

async function select(
  service: LocalCapabilityPort,
  operation = 'fixture-select',
): Promise<Extract<SelectDirectoryResult, { readonly state: 'selected' }>> {
  const result = await service.selectDirectory({
    interaction_ref: conformance.fixedRequest().interaction_ref,
    slot_ref: 'customer-directory',
    operation_id: OperationId(operation),
  })
  if (!result.ok || result.value.state !== 'selected') throw new Error('fixture selection unexpectedly failed')
  return result.value
}

describe('test-only local capability vertical composition', () => {
  it('contains native cancellation and replays the same operation without another selection', async () => {
    const { ctx, fiber } = await mount()
    try {
      const service = ctx.localCapability
      const control = ctx.aistaffLocalCapabilityConformance
      control.directorySelector.cancelNext()
      const input = {
        interaction_ref: conformance.fixedRequest().interaction_ref,
        slot_ref: 'customer-directory',
        operation_id: OperationId('fixture-cancel'),
      }

      const first = await service.selectDirectory(input)
      const replay = await service.selectDirectory(input)

      expect(first).toEqual({ ok: true, value: { state: 'cancelled' } })
      expect(replay).toEqual(first)
      expect(control.directorySelector.calls).toBe(1)
      expect(snapshot(service)).toMatchObject({ resources: [], consents: [], view_generation: 0 })
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects cross-interaction, cross-slot, and stale revisions before Supervisor dispatch', async () => {
    const { ctx, fiber } = await mount()
    try {
      const service = ctx.localCapability
      const control = ctx.aistaffLocalCapabilityConformance
      const wrongInteraction = await service.selectDirectory({
        interaction_ref: InteractionRef('other-interaction'),
        slot_ref: 'customer-directory',
        operation_id: OperationId('fixture-wrong-interaction'),
      })
      const wrongSlot = await service.selectDirectory({
        interaction_ref: conformance.fixedRequest().interaction_ref,
        slot_ref: 'other-slot',
        operation_id: OperationId('fixture-wrong-slot'),
      })
      const selected = await select(service)
      const stale = await service.authorizeLocalOperation({
        interaction_ref: conformance.fixedRequest().interaction_ref,
        grant_handle: selected.resource.grant_handle,
        expected_interaction_revision: OwnerRevision('stale-interaction-revision'),
        expected_resource_revision: selected.resource.revision,
        operation_id: OperationId('fixture-stale-authorize'),
      })

      expect(wrongInteraction).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      expect(wrongSlot).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      expect(stale).toMatchObject({ ok: false, error: { code: 'VERSION_MISMATCH' } })
      expect(control.resultSink.lastPayloadKind()).toBeUndefined()
    } finally {
      await fiber.dispose()
    }
  })

  it('publishes canonical Material identity before the succeeded local Receipt and no payload copy', async () => {
    const { ctx, fiber } = await mount()
    try {
      const service = ctx.localCapability
      const selected = await select(service)
      const authorized = await service.authorizeLocalOperation({
        interaction_ref: conformance.fixedRequest().interaction_ref,
        grant_handle: selected.resource.grant_handle,
        expected_interaction_revision: conformance.fixedRequest().revision,
        expected_resource_revision: selected.resource.revision,
        operation_id: OperationId('fixture-authorize'),
      })

      expect(authorized).toMatchObject({
        ok: true,
        value: {
          status: 'succeeded',
          result_material_refs: ['local-material:fixture-authorize'],
        },
      })
      expect(ctx.aistaffLocalCapabilityConformance.resultSink.lastPayloadKind()).toBe('directory')
      const current = snapshot(service)
      expect(current).toMatchObject({
        consents: [{ state: 'authorized' }],
        receipts: [
          { result_material_refs: [] },
          { result_material_refs: ['local-material:fixture-authorize'] },
        ],
      })
      expect(Object.isFrozen(current)).toBe(true)
      expect(Object.isFrozen(current.receipts)).toBe(true)
    } finally {
      await fiber.dispose()
    }
  })

  it.each(receiptFailures)(
    'does not project an active resource when Grant registration returns $status',
    async ({ status, errorCode, operationState }) => {
      const { ctx, fiber } = await mountControlled('register', status)
      try {
        const operationId = OperationId(`fixture-register-${status}`)
        const result = await ctx.localCapability.selectDirectory({
          interaction_ref: conformance.fixedRequest().interaction_ref,
          slot_ref: 'customer-directory',
          operation_id: operationId,
        })
        const current = snapshot(ctx.localCapability)
        const operation = await ctx.localCapability.readOperation({ operation_id: operationId })

        expect(result).toMatchObject({
          ok: false,
          error: { code: errorCode, operation_id: operationId },
        })
        expect(current.resources).toEqual([])
        expect(current.consents).toEqual([])
        expect(current.receipts).toMatchObject([{ status, result_material_refs: [] }])
        expect(operation).toMatchObject({
          ok: true,
          value: { state: operationState, receipt_ref: current.receipts[0]!.receipt_ref },
        })
      } finally {
        await fiber.dispose()
      }
    },
  )

  it.each(receiptFailures)(
    'does not publish a read result when Supervisor returns a $status Receipt',
    async ({ status, errorCode, operationState }) => {
      const { ctx, fiber } = await mountControlled('read', status)
      try {
        const selected = await select(ctx.localCapability, `fixture-select-read-${status}`)
        const operationId = OperationId(`fixture-read-${status}`)
        const result = await ctx.localCapability.authorizeLocalOperation({
          interaction_ref: conformance.fixedRequest().interaction_ref,
          grant_handle: selected.resource.grant_handle,
          expected_interaction_revision: conformance.fixedRequest().revision,
          expected_resource_revision: selected.resource.revision,
          operation_id: operationId,
        })
        const current = snapshot(ctx.localCapability)
        const operation = await ctx.localCapability.readOperation({ operation_id: operationId })

        expect(result).toMatchObject({
          ok: false,
          error: { code: errorCode, operation_id: operationId },
        })
        expect(current.resources).toMatchObject([{ state: 'active' }])
        expect(current.consents).toMatchObject([{ state: 'authorized' }])
        expect(current.receipts.at(-1)).toMatchObject({ status, result_material_refs: [] })
        expect(current.receipts.flatMap(receipt => receipt.result_material_refs)).toEqual([])
        expect(operation).toMatchObject({
          ok: true,
          value: { state: operationState, receipt_ref: current.receipts.at(-1)!.receipt_ref },
        })
      } finally {
        await fiber.dispose()
      }
    },
  )

  it.each(receiptFailures)(
    'does not project revocation when Supervisor returns a $status Receipt',
    async ({ status, errorCode, operationState }) => {
      const { ctx, fiber } = await mountControlled('revoke', status)
      try {
        const selected = await select(ctx.localCapability, `fixture-select-revoke-${status}`)
        const operationId = OperationId(`fixture-revoke-${status}`)
        const result = await ctx.localCapability.revokeResource({
          grant_handle: selected.resource.grant_handle,
          expected_revision: selected.resource.revision,
          operation_id: operationId,
        })
        const current = snapshot(ctx.localCapability)
        const operation = await ctx.localCapability.readOperation({ operation_id: operationId })

        expect(result).toMatchObject({
          ok: false,
          error: { code: errorCode, operation_id: operationId },
        })
        expect(current.resources).toMatchObject([{ state: 'active' }])
        expect(current.consents).toMatchObject([{ state: 'pending' }])
        expect(current.receipts.at(-1)).toMatchObject({ status, result_material_refs: [] })
        expect(operation).toMatchObject({
          ok: true,
          value: { state: operationState, receipt_ref: current.receipts.at(-1)!.receipt_ref },
        })
      } finally {
        await fiber.dispose()
      }
    },
  )

  it('expires and revokes exact resource revisions without restoring a Grant', async () => {
    const expiredMount = await mount()
    try {
      const selected = await select(expiredMount.ctx.localCapability, 'fixture-select-expiry')
      expiredMount.ctx.aistaffLocalCapabilityConformance.clock.advance(60_001)
      const expired = await expiredMount.ctx.localCapability.authorizeLocalOperation({
        interaction_ref: conformance.fixedRequest().interaction_ref,
        grant_handle: selected.resource.grant_handle,
        expected_interaction_revision: conformance.fixedRequest().revision,
        expected_resource_revision: selected.resource.revision,
        operation_id: OperationId('fixture-expired-authorize'),
      })
      expect(expired).toMatchObject({ ok: false, error: { code: 'EXPIRED' } })
      expect(snapshot(expiredMount.ctx.localCapability)).toMatchObject({
        resources: [{ state: 'expired' }],
        consents: [{ state: 'expired' }],
      })
    } finally {
      await expiredMount.fiber.dispose()
    }

    const revokedMount = await mount()
    try {
      const selected = await select(revokedMount.ctx.localCapability, 'fixture-select-revoke')
      const revoked = await revokedMount.ctx.localCapability.revokeResource({
        grant_handle: selected.resource.grant_handle,
        expected_revision: selected.resource.revision,
        operation_id: OperationId('fixture-revoke'),
      })
      expect(revoked).toMatchObject({ ok: true, value: { status: 'succeeded' } })
      expect(snapshot(revokedMount.ctx.localCapability)).toMatchObject({
        resources: [{ state: 'revoked' }],
        consents: [{ state: 'revoked' }],
      })
    } finally {
      await revokedMount.fiber.dispose()
    }
  })

  it('does not publish a succeeded Receipt or Material identity when the canonical sink fails', async () => {
    const { ctx, fiber } = await mount()
    try {
      const service = ctx.localCapability
      const selected = await select(service, 'fixture-select-sink-failure')
      ctx.aistaffLocalCapabilityConformance.resultSink.failNext()
      const failed = await service.authorizeLocalOperation({
        interaction_ref: conformance.fixedRequest().interaction_ref,
        grant_handle: selected.resource.grant_handle,
        expected_interaction_revision: conformance.fixedRequest().revision,
        expected_resource_revision: selected.resource.revision,
        operation_id: OperationId('fixture-sink-failure'),
      })
      const current = snapshot(service)

      expect(failed).toMatchObject({ ok: false, error: { code: 'UNKNOWN_OUTCOME' } })
      expect(current.consents).toMatchObject([{ state: 'authorized' }])
      expect(current.receipts).toHaveLength(1)
      expect(current.receipts.flatMap(receipt => receipt.result_material_refs)).toEqual([])
      expect(current.receipts.some(receipt =>
        receipt.subject_ref === conformance.fixedRequest().interaction_ref && receipt.status === 'succeeded')).toBe(false)
    } finally {
      await fiber.dispose()
    }
  })

  it('replays the original operation, rejects changed input, and reconciles unknown without re-execution', async () => {
    const { ctx, fiber } = await mount()
    try {
      const service = ctx.localCapability
      const selected = await select(service, 'fixture-select-unknown')
      ctx.aistaffLocalCapabilityConformance.useUnknownOutcome()
      const input = {
        interaction_ref: conformance.fixedRequest().interaction_ref,
        grant_handle: selected.resource.grant_handle,
        expected_interaction_revision: conformance.fixedRequest().revision,
        expected_resource_revision: selected.resource.revision,
        operation_id: OperationId('fixture-unknown'),
      }

      const first = await service.authorizeLocalOperation(input)
      const replay = await service.authorizeLocalOperation(input)
      const conflict = await service.authorizeLocalOperation({
        ...input,
        expected_interaction_revision: OwnerRevision('different-revision'),
      })
      const reconciled = await service.readOperation({ operation_id: input.operation_id })

      expect(first).toMatchObject({ ok: false, error: { code: 'UNKNOWN_OUTCOME' } })
      expect(replay).toEqual(first)
      expect(conflict).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
      expect(reconciled).toMatchObject({ ok: true, value: { state: 'unknown' } })
      expect(snapshot(service)).toMatchObject({ consents: [{ state: 'authorized' }] })
    } finally {
      await fiber.dispose()
    }
  })

  it('never projects the fixture path, Supervisor transport, token, or FsTarget', async () => {
    const { ctx, fiber } = await mount()
    try {
      const selected = await select(ctx.localCapability, 'fixture-select-projection')
      const operation = await ctx.localCapability.readOperation({
        operation_id: OperationId('fixture-select-projection'),
      })
      const serialized = JSON.stringify({ selected, snapshot: snapshot(ctx.localCapability), operation })

      expect(serialized).not.toContain('/fixture/customer-documents')
      expect(serialized).not.toMatch(/root_path|socket|token|FsTarget|capability_context/i)
      expect(conformance.LOCAL_CAPABILITY_CONFORMANCE_PROVENANCE.test_only).toBe(true)
    } finally {
      await fiber.dispose()
    }
  })
})
