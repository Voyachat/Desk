import { Context } from '@deepseek-ai/cordis'
import {
  EmployeeRef,
  OwnerRevision,
  type EmployeeExperienceSnapshot,
  type EmployeeWorkforceView,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import { describe, expect, it } from 'vitest'
import * as provider from '../src/index.ts'
import type {
  ClientGatewayContractArtifact,
  ClientGatewaySelection,
  ClientGatewayTransport,
  DecodedGatewayError,
  GatewayTransportRequest,
  GatewayTransportResponse,
  GatewayTransportSubscription,
  ProjectionBaseline,
  ProjectionSnapshotLease,
  SelectedGatewayResult,
} from '@deepseek-ai/dsh-aistaff-cloud-client'

const protocol = '1.7'
const selectionRef = 'selection-1'
const headers = {
  'Aistaff-Client-Protocol': protocol,
  'Aistaff-Contract-Selection': selectionRef,
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

function response(status: number, body: unknown): GatewayTransportResponse {
  return { status, headers, body }
}

function selected<T>(input: GatewayTransportResponse): SelectedGatewayResult<T> {
  return { protocol, contractSelectionRef: selectionRef, value: input.body as T }
}

const selection: ClientGatewaySelection = {
  protocol,
  contractSelectionRef: selectionRef,
  contractSelectionExpiresAt: '2099-01-01T00:00:00.000Z',
  clientMode: 'none',
  envelopeContract: 'employee-event@1.0',
  identityKey: 'issuer/tenant/subject/device/revision',
}

const workforce: EmployeeWorkforceView = {
  revision: OwnerRevision('workforce-revision'),
  observed_at: '2026-08-15T00:00:00.000Z',
  employees: [{
    employee_ref: EmployeeRef('employee-1'),
    display_name: '云端员工',
    role_label: '分析师',
    availability: 'ready',
    capability_labels: ['分析'],
    allowed_actions: { open: { allowed: true } },
  }],
}

function unreachable(): never {
  throw new Error('fixture operation was not expected')
}

const artifact: ClientGatewayContractArtifact = {
  artifactVersion: '1.0.0-fixture',
  rootHash: 'fixture-root-hash',
  encodeClientHello: value => value,
  decodeBootstrap: () => selection,
  decodeBootstrapError: input => input.body as DecodedGatewayError,
  encodeCreateProjectionSnapshot: operationId => ({ operation_id: operationId }),
  decodeProjectionSnapshot: input => selected<ProjectionSnapshotLease>(input),
  decodeWorkforce: input => selected(input),
  decodeEngagementPage: input => selected(input),
  decodeEngagementSnapshot: unreachable,
  mergeEngagementSnapshotPages: unreachable,
  encodeOpenEngagement: unreachable,
  decodeOpenEngagement: unreachable,
  encodeSubmitInput: unreachable,
  decodeActivity: unreachable,
  encodeInteractionResponse: unreachable,
  decodeInteractionReceipt: unreachable,
  encodeMaterialAccess: unreachable,
  decodeMaterialAccess: unreachable,
  decodeMaterialContent: unreachable,
  decodeOperation: unreachable,
  recoverOperation: unreachable,
  decodeError: input => input.body as DecodedGatewayError,
  decodeEmployeeEvent: unreachable,
  composeBaseline: (input: ProjectionBaseline): EmployeeExperienceSnapshot => ({
    state: 'ready',
    workforce: input.workforce,
    engagements: [],
    has_more_engagements: false,
    current_engagement: null,
    view_generation: input.previousGeneration + 1,
    observed_at: input.observedAt,
  }),
  applyReplacement: unreachable,
  fingerprint: unreachable,
}

class FixtureTransport implements ClientGatewayTransport {
  readonly workforceStarted = deferred()
  readonly streamStarted = deferred()
  readonly streamFinished = deferred()
  subscribeSignal: AbortSignal | undefined

  constructor(private readonly workforceGate: Promise<void> = Promise.resolve()) {}

  async request(input: GatewayTransportRequest): Promise<GatewayTransportResponse> {
    switch (input.operation) {
      case 'clientBootstrap': return response(200, selection)
      case 'createProjectionSnapshot': return response(200, {
        snapshotRef: 'snapshot-1',
        streamRef: 'stream-1',
        resumeCursor: 'cursor-0',
      })
      case 'getWorkforceSnapshot':
        this.workforceStarted.resolve()
        await this.workforceGate
        return response(200, {
          value: workforce,
          snapshotRef: 'snapshot-1',
          streamRef: 'stream-1',
          resumeCursor: 'cursor-0',
        })
      case 'listEngagements': return response(200, {
        items: [],
        ownerRevision: 'engagement-revision',
        snapshotRef: 'snapshot-1',
        streamRef: 'stream-1',
        resumeCursor: 'cursor-0',
      })
      default: return Promise.reject(new Error(`unexpected fixture operation ${input.operation}`))
    }
  }

  async subscribe(input: GatewayTransportRequest): Promise<GatewayTransportSubscription> {
    this.subscribeSignal = input.signal
    this.streamStarted.resolve()
    return { status: 200, headers, frames: this.frames(input.signal) }
  }

  private async *frames(signal: AbortSignal): AsyncIterable<never> {
    if (!signal.aborted) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    }
    this.streamFinished.resolve()
  }
}

const config: provider.Config = {
  protocolOffer: '1.0-1.7',
  requestTimeoutMs: 1_000,
  pageLimit: 20,
  selectionRenewalSkewMs: 30_000,
  reconnectDelayMs: 10,
}

function provideInputs(ctx: Context, transport: ClientGatewayTransport): void {
  new provider.AistaffClientGatewayInputs(ctx, {
    artifact,
    transport,
    clientHello: { client_mode: 'none' },
  })
}

describe('Aistaff Cloud provider composition', () => {
  it('fails loud on missing inputs without publishing employeeExperience', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(provider, config)

    await expect(fiber).rejects.toMatchObject({
      code: provider.CLIENT_GATEWAY_UNAVAILABLE,
      reason: 'missing_inputs',
    })
    expect(ctx.get('employeeExperience')).toBeUndefined()
  })

  it('publishes employeeExperience only after the full baseline synchronizes', async () => {
    const gate = deferred()
    const transport = new FixtureTransport(gate.promise)
    const ctx = new Context()
    provideInputs(ctx, transport)
    const fiber = ctx.plugin(provider, config)

    await transport.workforceStarted.promise
    expect(ctx.get('employeeExperience')).toBeUndefined()
    gate.resolve()
    await fiber

    expect(ctx.get('employeeExperience')).toBeDefined()
    expect(ctx.employeeExperience.observe(() => {}).snapshot).toMatchObject({
      state: 'ready',
      view_generation: 1,
      workforce: { employees: [{ display_name: '云端员工' }] },
    })
    await fiber.dispose()
  })

  it('aborts and joins the active SSE loop during disposal', async () => {
    const transport = new FixtureTransport()
    const ctx = new Context()
    provideInputs(ctx, transport)
    const fiber = ctx.plugin(provider, config)
    await fiber
    await transport.streamStarted.promise

    expect(transport.subscribeSignal?.aborted).toBe(false)
    await fiber.dispose()

    expect(transport.subscribeSignal?.aborted).toBe(true)
    await transport.streamFinished.promise
    expect(ctx.get('employeeExperience')).toBeUndefined()
  })
})
