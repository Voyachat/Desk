import { Context } from '@deepseek-ai/cordis'
import * as cloudConformance from '@deepseek-ai/dsh-aistaff-cloud-conformance'
import * as cloudProvider from '@deepseek-ai/dsh-aistaff-cloud-provider'
import {
  OperationId,
  type EmployeeExperiencePort,
  type EmployeeExperienceSnapshot,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalCapabilityPort,
  LocalCapabilitySnapshot,
} from '@deepseek-ai/dsh-aistaff-local-capability'
import {
  SupervisorEvidenceRef,
  SupervisorOperationId,
  SupervisorReceiptRef,
} from '@deepseek-ai/dsh-aistaff-supervisor-control'
import { describe, expect, it } from 'vitest'
import * as localConformance from '../src/index.ts'

const providerConfig: cloudProvider.Config = {
  protocolOffer: '1.0-1.7',
  requestTimeoutMs: 1_000,
  pageLimit: 20,
  selectionRenewalSkewMs: 30_000,
  reconnectDelayMs: 5,
}

function employeeSnapshot(service: EmployeeExperiencePort): EmployeeExperienceSnapshot {
  const observation = service.observe(() => {})
  observation.dispose()
  return observation.snapshot
}

function localSnapshot(service: LocalCapabilityPort): LocalCapabilitySnapshot {
  const observation = service.observe(() => {})
  observation.dispose()
  return observation.snapshot
}

async function waitFor<T>(read: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== undefined) return value
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for Cloud local conformance state')
}

async function mount(): Promise<{
  readonly ctx: Context
  readonly fixtureFiber: ReturnType<Context['plugin']>
  readonly providerFiber: ReturnType<Context['plugin']>
  readonly localFiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  const fixtureFiber = ctx.plugin(cloudConformance, { scenario: 'local_read' })
  await fixtureFiber
  const providerFiber = ctx.plugin(cloudProvider, providerConfig)
  await providerFiber
  const localFiber = ctx.plugin(localConformance)
  await localFiber
  return { ctx, fixtureFiber, providerFiber, localFiber }
}

describe('test-only Cloud local-read Host composition', () => {
  it('publishes selection, consent, canonical Material, both Receipts, and replayable completion', async () => {
    const { ctx, fixtureFiber, providerFiber, localFiber } = await mount()
    try {
      const employee = ctx.employeeExperience
      const local = ctx.localCapability
      const control = ctx.aistaffCloudConformance
      expect(control.scenario).toBe('local_read')
      await waitFor(() => control.gateway.subscribedAfterCursors.length > 0 ? true : undefined)

      const workforce = employeeSnapshot(employee).workforce
      const opened = await employee.openEngagement({
        operation_id: OperationId('fixture-local-open'),
        employee_ref: workforce!.employees[0]!.employee_ref,
        title: '本机只读验收',
      })
      if (!opened.ok) throw new Error('fixture engagement open unexpectedly failed')
      const detail = await waitFor(() => employeeSnapshot(employee).current_engagement ?? undefined)
      const submitted = await employee.submitInput({
        operation_id: OperationId('fixture-local-submit'),
        engagement_ref: detail.engagement.engagement_ref,
        parts: [{ kind: 'text', text: '读取客户资料目录' }],
        expected_revision: detail.engagement.revision,
      })
      expect(submitted).toMatchObject({ ok: true, value: { display_state: 'queued' } })

      const waiting = await waitFor(() => {
        const current = employeeSnapshot(employee).current_engagement
        const interaction = current?.interactions[0]
        return interaction?.kind === 'local_operation' && current?.activities[0]?.display_state === 'waiting_user'
          ? { current, interaction }
          : undefined
      })
      expect(waiting.interaction).toMatchObject({
        title: 'test_only：读取本机客户资料目录',
        capability_ref: 'directory/list',
        operation: 'directory/list',
        risk: 'medium',
        effect_class: 'none',
        resource_requirements: [{
          slot_ref: 'customer-directory',
          resource_kind: 'directory',
          access: 'read',
        }],
      })

      const selected = await local.selectDirectory({
        interaction_ref: waiting.interaction.interaction_ref,
        slot_ref: 'customer-directory',
        operation_id: OperationId('fixture-local-select'),
      })
      if (!selected.ok || selected.value.state !== 'selected') throw new Error('fixture selection unexpectedly failed')
      expect(selected.value.resource).toMatchObject({
        display_name: '客户资料',
        resource_kind: 'directory',
        access: 'read',
        state: 'active',
      })
      expect(selected.value.consent.state).toBe('pending')

      const subscriptionsBeforeCommit = control.gateway.subscribedAfterCursors.length
      const authorizeOperation = OperationId('fixture-local-authorize')
      const authorized = await local.authorizeLocalOperation({
        interaction_ref: waiting.interaction.interaction_ref,
        grant_handle: selected.value.resource.grant_handle,
        expected_interaction_revision: waiting.interaction.revision,
        expected_resource_revision: selected.value.resource.revision,
        operation_id: authorizeOperation,
      })
      expect(authorized).toMatchObject({
        ok: true,
        value: { status: 'succeeded', result_material_refs: ['fixture-local-material-1'] },
      })

      const completed = await waitFor(() => {
        const current = employeeSnapshot(employee).current_engagement
        return current?.activities[0]?.display_state === 'succeeded'
          && current.materials.length === 1
          && current.receipts.length === 1
          && current.interactions.length === 0
          ? current
          : undefined
      })
      expect(completed.materials[0]).toMatchObject({
        material_ref: 'fixture-local-material-1',
        title: '本机目录列表',
        body: {
          kind: 'structured',
          value: { entries: [{ name: '经营数据.csv', kind: 'file', size_bytes: 128 }, { name: '归档', kind: 'directory' }] },
        },
      })
      expect(completed.receipts[0]).toMatchObject({
        subject_ref: waiting.interaction.interaction_ref,
        status: 'succeeded',
        result_material_refs: ['fixture-local-material-1'],
      })
      expect(localSnapshot(local)).toMatchObject({
        resources: [{ display_name: '客户资料', state: 'active' }],
        consents: [{ state: 'authorized' }],
        receipts: [
          { result_material_refs: [] },
          { status: 'succeeded', result_material_refs: ['fixture-local-material-1'] },
        ],
      })

      const replay = await new localConformance.CloudConformanceLocalResultSink(control).publish({
        interaction: waiting.interaction,
        operation_id: authorizeOperation,
        result: {
          payload: {
            kind: 'directory',
            entries: [{ name: '经营数据.csv', kind: 'file', size_bytes: 128 }, { name: '归档', kind: 'directory' }],
          },
          receipt: {
            receipt_ref: SupervisorReceiptRef('fixture-replay-receipt'),
            operation_id: SupervisorOperationId(authorizeOperation),
            status: 'succeeded',
            effect_state: 'none',
            evidence_refs: [SupervisorEvidenceRef('fixture-replay-evidence')],
            receipt_hash: 'fixture-replay-hash',
            recorded_at: '2026-08-15T00:00:00.000Z',
          },
        },
      })
      expect(replay.material_refs).toEqual(['fixture-local-material-1'])
      expect(control.localResultCommitCount).toBe(1)

      const refreshed = await employee.readEngagement({ engagement_ref: completed.engagement.engagement_ref })
      expect(refreshed).toMatchObject({ ok: true, value: { interactions: [], receipts: [{ status: 'succeeded' }] } })
      control.disconnectActiveStreams()
      await waitFor(() => control.gateway.subscribedAfterCursors.length > subscriptionsBeforeCommit ? true : undefined)
      expect(employeeSnapshot(employee).current_engagement?.interactions).toEqual([])

      const leasesBeforeExpiry = control.gateway.snapshotLeaseCount
      control.expireNextSubscription()
      control.disconnectActiveStreams()
      await waitFor(() => control.gateway.snapshotLeaseCount > leasesBeforeExpiry ? true : undefined)
      const rebuilt = await waitFor(() => {
        const current = employeeSnapshot(employee).current_engagement
        return current?.activities[0]?.display_state === 'succeeded' && current.interactions.length === 0
          ? current
          : undefined
      })
      const visible = JSON.stringify({ employee: rebuilt, local: localSnapshot(local) })
      expect(visible).not.toMatch(/\/fixture\/customer-documents|root_path|socket|token|FsTarget/i)
    } finally {
      await localFiber.dispose()
      await providerFiber.dispose()
      await fixtureFiber.dispose()
    }
  })

  it('fails loud when mounted over the default approval scenario', async () => {
    const ctx = new Context()
    const fixtureFiber = ctx.plugin(cloudConformance)
    await fixtureFiber
    const localFiber = ctx.plugin(localConformance)
    await expect(localFiber).rejects.toThrow('requires the explicit local_read scenario')
    expect(ctx.get('localCapability')).toBeUndefined()
    await fixtureFiber.dispose()
  })
})
