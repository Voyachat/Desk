import { Context } from '@deepseek-ai/cordis'
import CloudClientGatewayAdapter from '@deepseek-ai/dsh-aistaff-cloud-client'
import * as cloudProvider from '@deepseek-ai/dsh-aistaff-cloud-provider'
import {
  OperationId,
  type EmployeeExperiencePort,
  type EmployeeExperienceSnapshot,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import { describe, expect, it } from 'vitest'
import * as conformance from '../src/index.ts'

const providerConfig: cloudProvider.Config = {
  protocolOffer: '1.0-1.7',
  requestTimeoutMs: 1_000,
  pageLimit: 20,
  selectionRenewalSkewMs: 30_000,
  reconnectDelayMs: 5,
}

function snapshot(service: EmployeeExperiencePort): EmployeeExperienceSnapshot {
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
  throw new Error('timed out waiting for conformance state')
}

async function mount(): Promise<{
  readonly ctx: Context
  readonly fixtureFiber: ReturnType<Context['plugin']>
  readonly providerFiber: ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  const fixtureFiber = ctx.plugin(conformance)
  await fixtureFiber
  const providerFiber = ctx.plugin(cloudProvider, providerConfig)
  await providerFiber
  return { ctx, fixtureFiber, providerFiber }
}

describe('test-only Client Gateway conformance composition', () => {
  it('publishes the full Workforce to Receipt flow and replays after reconnect', async () => {
    const { ctx, fixtureFiber, providerFiber } = await mount()
    try {
      const service = ctx.employeeExperience
      const control = ctx.aistaffCloudConformance
      const initial = snapshot(service)

      expect(control.scenario).toBe('approval')

      expect(initial).toMatchObject({
        state: 'ready',
        engagements: [],
        workforce: {
          employees: [{ display_name: '云端经营分析员工', availability: 'ready' }],
        },
      })
      expect(JSON.stringify(initial)).not.toMatch(/snapshot_ref|stream_ref|resume_cursor|contract_selection|token/i)
      await waitFor(() => control.gateway.subscribedAfterCursors.length > 0 ? true : undefined)

      const employee = initial.workforce?.employees[0]
      expect(employee).toBeDefined()
      const opened = await service.openEngagement({
        operation_id: OperationId('fixture-operation-open'),
        employee_ref: employee!.employee_ref,
        title: '经营分析验收',
      })
      expect(opened).toMatchObject({ ok: true, value: { title: '经营分析验收' } })

      const openedSnapshot = await waitFor(() => {
        const value = snapshot(service)
        return value.current_engagement === null ? undefined : value
      })
      const detail = openedSnapshot.current_engagement!

      control.duplicateNextEvent()
      const submitOperationId = OperationId('fixture-operation-submit')
      const submitted = await service.submitInput({
        operation_id: submitOperationId,
        engagement_ref: detail.engagement.engagement_ref,
        parts: [{ kind: 'text', text: '分析本月经营数据' }],
        expected_revision: detail.engagement.revision,
      })
      expect(submitted).toMatchObject({ ok: true, value: { display_state: 'queued' } })

      const waitingSnapshot = await waitFor(() => {
        const value = snapshot(service)
        const current = value.current_engagement
        return current?.activities[0]?.display_state === 'waiting_user'
          && current.materials.length === 1
          && current.interactions.length === 1
          ? value
          : undefined
      })
      expect(control.gateway.duplicateDeliveryCount).toBe(1)

      const operation = await service.readOperation({ operation_id: submitOperationId })
      expect(operation).toMatchObject({
        ok: true,
        value: {
          operation_id: submitOperationId,
          action: 'submitEmployeeActivity',
          state: 'succeeded',
          outcome: { kind: 'result' },
        },
      })

      const material = waitingSnapshot.current_engagement!.materials[0]!
      const granted = await service.createMaterialAccess({
        operation_id: OperationId('fixture-operation-material'),
        material_ref: material.material_ref,
        action: 'preview',
        purpose: '用户查看分析结果',
        expected_revision: material.revision,
      })
      expect(granted).toMatchObject({ ok: true, value: { action: 'preview', byte_size: 12 } })
      if (!granted.ok) throw new Error('fixture material grant unexpectedly failed')
      const content = await (service as CloudClientGatewayAdapter).readMaterialContent(granted.value)
      expect(content.ok && new TextDecoder().decode(content.value)).toBe('分析完成')

      const cursorsBeforeReconnect = control.gateway.subscribedAfterCursors.length
      control.disconnectActiveStreams()
      const interaction = waitingSnapshot.current_engagement!.interactions[0]!
      const responded = await service.respondInteraction({
        operation_id: OperationId('fixture-operation-respond'),
        interaction_ref: interaction.interaction_ref,
        outcome_id: 'approve',
        expected_revision: interaction.revision,
      })
      expect(responded).toMatchObject({ ok: true, value: { status: 'succeeded' } })

      const succeeded = await waitFor(() => {
        const value = snapshot(service)
        const current = value.current_engagement
        return current?.activities[0]?.display_state === 'succeeded'
          && current.receipts.length === 1
          && current.interactions.length === 0
          ? value
          : undefined
      })
      await waitFor(() => control.gateway.subscribedAfterCursors.length > cursorsBeforeReconnect ? true : undefined)
      expect(control.gateway.subscribedAfterCursors[cursorsBeforeReconnect]).toBe('fixture-cursor-000005')
      expect(succeeded.current_engagement).toMatchObject({
        activities: [{ display_state: 'succeeded' }],
        interactions: [],
        receipts: [{ status: 'succeeded' }],
      })

      const subscriptionsBeforeSecondReconnect = control.gateway.subscribedAfterCursors.length
      control.disconnectActiveStreams()
      await waitFor(() => control.gateway.subscribedAfterCursors.length > subscriptionsBeforeSecondReconnect ? true : undefined)
      expect(control.gateway.subscribedAfterCursors.at(-1)).toBe('fixture-cursor-000007')
      expect(snapshot(service).current_engagement?.interactions).toEqual([])
      expect(JSON.stringify(succeeded)).not.toMatch(/snapshot_ref|stream_ref|resume_cursor|contract_selection|token/i)
    } finally {
      await providerFiber.dispose()
      await fixtureFiber.dispose()
    }
  })

  it('rebuilds the complete baseline after a cursor-expired reconnect', async () => {
    const { ctx, fixtureFiber, providerFiber } = await mount()
    try {
      const control = ctx.aistaffCloudConformance
      const generation = snapshot(ctx.employeeExperience).view_generation
      await waitFor(() => control.gateway.subscribedAfterCursors.length > 0 ? true : undefined)

      control.expireNextSubscription()
      control.disconnectActiveStreams()

      await waitFor(() => control.gateway.snapshotLeaseCount >= 2 ? true : undefined)
      await waitFor(() => control.gateway.subscribedAfterCursors.length >= 3 ? true : undefined)
      expect(snapshot(ctx.employeeExperience)).toMatchObject({
        state: 'ready',
        view_generation: generation + 1,
        engagements: [],
      })
      expect(control.gateway.subscribedAfterCursors.slice(-2)).toEqual([
        'fixture-cursor-000000',
        'fixture-cursor-000000',
      ])
    } finally {
      await providerFiber.dispose()
      await fixtureFiber.dispose()
    }
  })

  it('exposes immutable, explicitly test-only artifact provenance', () => {
    expect(conformance.CONFORMANCE_ARTIFACT_PROVENANCE).toEqual({
      test_only: true,
      artifact_version: conformance.CONFORMANCE_ARTIFACT_VERSION,
      root_hash: conformance.CONFORMANCE_ARTIFACT_ROOT_HASH,
      source: 'AiDesktop local Client Gateway conformance fixture',
    })
    expect(conformance.CONFORMANCE_ARTIFACT_ROOT_HASH).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(conformance.CONFORMANCE_ARTIFACT_PROVENANCE)).toBe(true)
  })
})
