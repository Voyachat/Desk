import { Context } from '@deepseek-ai/cordis'
import {
  ActivityRef,
  ContentRef,
  EmployeeRef,
  EngagementRef,
  InteractionRef,
  MaterialAccessGrantRef,
  MaterialRef,
  OperationId,
  OwnerRevision,
  ReceiptRef,
  type ActivityView,
  type EffectReceiptView,
  type EmployeeExperienceSnapshot,
  type EmployeeWorkforceView,
  type EngagementSnapshot,
  type EngagementView,
  type InteractionResponseInput,
  type MaterialAccessGrant,
  type MaterialAccessInput,
  type OpenEngagementInput,
  type OperationStatusView,
  type SubmitEmployeeInput,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import { describe, expect, it } from 'vitest'
import CloudClientGatewayAdapter, { ClientGatewayTransportError } from '../src/index.ts'
import type {
  ClientGatewayContractArtifact,
  ClientGatewaySelection,
  ClientGatewayTransport,
  DecodedEmployeeEvent,
  DecodedGatewayError,
  GatewayOperation,
  GatewaySseFrame,
  GatewayTransportRequest,
  GatewayTransportResponse,
  GatewayTransportSubscription,
  ProjectionBaseline,
  ProjectionSnapshotLease,
  SelectedGatewayResult,
} from '../src/index.ts'

const protocol = '1.7'
const now = '2026-08-15T08:00:00.000Z'
const employeeRef = EmployeeRef('employee-1')
const engagementRef = EngagementRef('engagement-1')
const activityRef = ActivityRef('activity-1')
const materialRef = MaterialRef('material-1')
const interactionRef = InteractionRef('interaction-1')
const revision = OwnerRevision('revision-1')

function selection(ref = 'selection-1'): ClientGatewaySelection {
  return {
    protocol,
    contractSelectionRef: ref,
    contractSelectionExpiresAt: '2027-08-15T08:00:00.000Z',
    clientMode: 'none',
    envelopeContract: 'employee-event@1.1',
    identityKey: 'issuer/tenant/subject/device/revision-1',
  }
}

function selectedHeaders(ref = 'selection-1'): Record<string, string> {
  return {
    'Aistaff-Client-Protocol': protocol,
    'Aistaff-Contract-Selection': ref,
  }
}

function response(status: number, body: unknown, ref = 'selection-1'): GatewayTransportResponse {
  return { status, headers: selectedHeaders(ref), body }
}

function initialSnapshot(): EmployeeExperienceSnapshot {
  return {
    state: 'loading',
    workforce: null,
    engagements: [],
    has_more_engagements: false,
    current_engagement: null,
    view_generation: 0,
  }
}

function workforce(displayName = '经营分析员工'): EmployeeWorkforceView {
  return {
    revision,
    observed_at: now,
    employees: [{
      employee_ref: employeeRef,
      display_name: displayName,
      role_label: '分析师',
      availability: 'ready',
      capability_labels: ['分析'],
      allowed_actions: { open: { allowed: true } },
    }],
  }
}

function engagement(title = '经营分析'): EngagementView {
  return {
    engagement_ref: engagementRef,
    employee_ref: employeeRef,
    title,
    display_state: 'ready',
    revision,
    created_at: now,
    updated_at: now,
  }
}

function activity(state: ActivityView['display_state'] = 'queued'): ActivityView {
  return {
    activity_ref: activityRef,
    engagement_ref: engagementRef,
    employee_ref: employeeRef,
    display_state: state,
    material_refs: [],
    interaction_refs: [],
    revision,
    created_at: now,
    updated_at: now,
  }
}

function engagementDetail(title = '经营分析'): EngagementSnapshot {
  return {
    engagement: engagement(title),
    activities: [],
    materials: [],
    interactions: [],
    receipts: [],
    has_more: false,
    owner_revision: revision,
  }
}

function receipt(): EffectReceiptView {
  return {
    receipt_ref: ReceiptRef('receipt-1'),
    subject_ref: interactionRef,
    status: 'accepted',
    effect_state: 'none',
    result_material_refs: [],
    revision,
    recorded_at: now,
  }
}

function materialGrant(): MaterialAccessGrant {
  return {
    grant_ref: MaterialAccessGrantRef('grant-1'),
    material_ref: materialRef,
    action: 'preview',
    content_ref: ContentRef('content-1'),
    media_type: 'text/plain',
    byte_size: 2,
    content_hash: 'sha256-fixture',
    expires_at: '2026-08-15T09:00:00.000Z',
  }
}

function operationStatus(result: unknown = activity()): OperationStatusView {
  return {
    operation_id: OperationId('operation-1'),
    action: 'submitEmployeeActivity',
    state: 'accepted',
    outcome: {
      kind: 'result',
      result_contract: {
        name: 'ActivityView',
        major: 1,
        minor: 0,
        schema_ref: 'schemas/activity.json',
        schema_hash: 'activity-schema-hash',
      },
      result: result as never,
      result_hash: 'activity-result-hash',
    },
    revision,
    updated_at: now,
  }
}

function result<T>(responseValue: GatewayTransportResponse): SelectedGatewayResult<T> {
  return {
    protocol: responseValue.headers['Aistaff-Client-Protocol']!,
    contractSelectionRef: responseValue.headers['Aistaff-Contract-Selection']!,
    value: responseValue.body as T,
  }
}

function applyEvent(snapshot: EmployeeExperienceSnapshot, event: Parameters<ClientGatewayContractArtifact['applyReplacement']>[1]): EmployeeExperienceSnapshot {
  const generation = snapshot.view_generation + 1
  if (event.type === 'workforce.changed') return { ...snapshot, workforce: event.value, view_generation: generation, observed_at: now }
  if (event.type === 'engagement.changed') {
    const engagements = snapshot.engagements.some(item => item.engagement_ref === event.value.engagement_ref)
      ? snapshot.engagements.map(item => item.engagement_ref === event.value.engagement_ref ? event.value : item)
      : [...snapshot.engagements, event.value]
    const current = snapshot.current_engagement?.engagement.engagement_ref === event.value.engagement_ref
      ? { ...snapshot.current_engagement, engagement: event.value }
      : snapshot.current_engagement
    return { ...snapshot, engagements, current_engagement: current, view_generation: generation, observed_at: now }
  }
  const current = snapshot.current_engagement
  if (current === null) return { ...snapshot, view_generation: generation, observed_at: now }
  switch (event.type) {
    case 'activity.changed':
      return {
        ...snapshot,
        current_engagement: {
          ...current,
          activities: replaceBy(current.activities, event.value, item => item.activity_ref, event.value.activity_ref),
        },
        view_generation: generation,
        observed_at: now,
      }
    case 'material.changed':
      return {
        ...snapshot,
        current_engagement: {
          ...current,
          materials: replaceBy(current.materials, event.value, item => item.material_ref, event.value.material_ref),
        },
        view_generation: generation,
        observed_at: now,
      }
    case 'interaction.changed':
      return {
        ...snapshot,
        current_engagement: {
          ...current,
          interactions: replaceBy(current.interactions, event.value, item => item.interaction_ref, event.value.interaction_ref),
        },
        view_generation: generation,
        observed_at: now,
      }
    case 'receipt.changed':
      return {
        ...snapshot,
        current_engagement: {
          ...current,
          receipts: replaceBy(current.receipts, event.value, item => item.receipt_ref, event.value.receipt_ref),
        },
        view_generation: generation,
        observed_at: now,
      }
  }
}

function replaceBy<T, K>(values: readonly T[], next: T, key: (value: T) => K, wanted: K): readonly T[] {
  return values.some(item => key(item) === wanted)
    ? values.map(item => key(item) === wanted ? next : item)
    : [...values, next]
}

const artifact: ClientGatewayContractArtifact = {
  artifactVersion: '1.0.0-fixture',
  rootHash: 'fixture-root-hash',
  encodeClientHello: input => input,
  decodeBootstrap: input => input.body as ClientGatewaySelection,
  decodeBootstrapError: input => input.body as DecodedGatewayError,
  encodeCreateProjectionSnapshot: operationId => ({ operation_id: operationId }),
  decodeProjectionSnapshot: input => result<ProjectionSnapshotLease>(input),
  decodeWorkforce: input => result(input),
  decodeEngagementPage: input => result(input),
  decodeEngagementSnapshot: input => result(input),
  mergeEngagementSnapshotPages: pages => {
    const [first, ...rest] = pages
    if (first === undefined) throw new TypeError('fixture requires one engagement snapshot page')
    return rest.reduce<EngagementSnapshot>((merged, page) => ({
      engagement: page.engagement,
      activities: [...merged.activities, ...page.activities],
      materials: [...merged.materials, ...page.materials],
      interactions: [...merged.interactions, ...page.interactions],
      receipts: [...merged.receipts, ...page.receipts],
      has_more: page.has_more,
      owner_revision: page.owner_revision,
    }), first)
  },
  encodeOpenEngagement: ({ operation_id: operationId, ...input }) => ({ operation_id: operationId, ...input }),
  decodeOpenEngagement: input => result(input),
  encodeSubmitInput: ({ engagement_ref: _engagementRef, ...input }) => input,
  decodeActivity: input => result(input),
  encodeInteractionResponse: ({ interaction_ref: _interactionRef, ...input }) => input,
  decodeInteractionReceipt: input => result(input),
  encodeMaterialAccess: ({ material_ref: _materialRef, ...input }) => input,
  decodeMaterialAccess: input => result(input),
  decodeMaterialContent: (input, grant) => {
    const value = input.body as Uint8Array
    if (value.byteLength !== grant.byte_size) throw new Error('fixture content length mismatch')
    return value
  },
  decodeOperation: input => result(input),
  recoverOperation: <T>(_operation: GatewayOperation, status: OperationStatusView) => {
    if (status.outcome?.kind === 'result') return { kind: 'resolved' as const, value: status.outcome.result as T }
    if (status.outcome?.kind === 'error') {
      return { kind: 'failed' as const, error: { code: 'UNKNOWN_OUTCOME' as const, retryable: false } }
    }
    return { kind: 'pending' as const }
  },
  decodeError: input => input.body as DecodedGatewayError,
  decodeEmployeeEvent: frame => frame.data as DecodedEmployeeEvent,
  composeBaseline: (input: ProjectionBaseline) => ({
    state: 'ready',
    workforce: input.workforce,
    engagements: input.engagements,
    has_more_engagements: false,
    current_engagement: input.engagementSnapshots[0] ?? null,
    view_generation: input.previousGeneration + 1,
    observed_at: input.observedAt,
  }),
  applyReplacement: applyEvent,
  fingerprint: (operation, input) => `${operation}:${JSON.stringify(input)}`,
}

type RequestResponder = (request: GatewayTransportRequest, transport: FixtureTransport) => Promise<GatewayTransportResponse>
type SubscribeResponder = (request: GatewayTransportRequest, transport: FixtureTransport) => Promise<GatewayTransportSubscription>

class FixtureTransport implements ClientGatewayTransport {
  readonly requests: GatewayTransportRequest[] = []
  readonly subscriptions: GatewayTransportRequest[] = []
  selectionRef = 'selection-1'
  baselineCount = 0

  constructor(
    private readonly requestResponder: RequestResponder = defaultRequest,
    private readonly subscribeResponder: SubscribeResponder = defaultSubscribe,
  ) {}

  async request(input: GatewayTransportRequest): Promise<GatewayTransportResponse> {
    this.requests.push(input)
    return this.requestResponder(input, this)
  }

  async subscribe(input: GatewayTransportRequest): Promise<GatewayTransportSubscription> {
    this.subscriptions.push(input)
    return this.subscribeResponder(input, this)
  }
}

async function defaultRequest(request: GatewayTransportRequest, transport: FixtureTransport): Promise<GatewayTransportResponse> {
  const ref = transport.selectionRef
  switch (request.operation) {
    case 'clientBootstrap': return response(200, selection(ref), ref)
    case 'createProjectionSnapshot':
      transport.baselineCount += 1
      return response(200, {
        snapshotRef: `snapshot-${String(transport.baselineCount)}`,
        streamRef: `stream-${String(transport.baselineCount)}`,
        resumeCursor: `cursor-${String(transport.baselineCount)}-0`,
      }, ref)
    case 'getWorkforceSnapshot': {
      const lease = leaseFromPath(request.path, transport.baselineCount)
      return response(200, { ...lease, value: workforce(`经营分析员工 ${String(transport.baselineCount)}`) }, ref)
    }
    case 'listEngagements': {
      const lease = leaseFromPath(request.path, transport.baselineCount)
      return response(200, { ...lease, items: [engagement()], ownerRevision: revision }, ref)
    }
    case 'getEngagementSnapshot': {
      const lease = leaseFromPath(request.path, transport.baselineCount)
      return response(200, { ...lease, value: engagementDetail() }, ref)
    }
    case 'openEngagement': return response(201, engagement(), ref)
    case 'submitEmployeeActivity': return response(202, activity(), ref)
    case 'respondInteraction': return response(200, receipt(), ref)
    case 'createMaterialAccessGrant': return response(201, materialGrant(), ref)
    case 'getMaterialContent': return response(200, new Uint8Array([79, 75]), ref)
    case 'getOperation': return response(200, operationStatus(), ref)
    case 'subscribeEmployeeEvents': throw new Error('subscribe must use transport.subscribe')
  }
}

async function defaultSubscribe(_request: GatewayTransportRequest, transport: FixtureTransport): Promise<GatewayTransportSubscription> {
  return { status: 200, headers: selectedHeaders(transport.selectionRef), frames: frames([]) }
}

function leaseFromPath(path: string, fallback: number): ProjectionSnapshotLease {
  const match = /snapshot_ref=([^&]+)/.exec(path)
  const snapshotRef = match?.[1] === undefined ? `snapshot-${String(fallback)}` : decodeURIComponent(match[1])
  const count = Number(snapshotRef.split('-').at(-1) ?? fallback)
  return {
    snapshotRef,
    streamRef: `stream-${String(count)}`,
    resumeCursor: `cursor-${String(count)}-0`,
  }
}

async function* frames(values: readonly GatewaySseFrame[]): AsyncIterable<GatewaySseFrame> {
  for (const value of values) yield value
}

function adapter(transport: ClientGatewayTransport): CloudClientGatewayAdapter {
  let operation = 0
  return new CloudClientGatewayAdapter(new Context(), {
    protocolOffer: '1.0-1.7',
    requestTimeoutMs: 100,
    pageLimit: 20,
    selectionRenewalSkewMs: 30_000,
    clock: () => new Date(now),
    createOperationId: () => `snapshot-operation-${String(++operation)}`,
    transport,
    artifact,
    initialSnapshot: initialSnapshot(),
  })
}

async function synchronize(service: CloudClientGatewayAdapter): Promise<void> {
  const result = await service.synchronize({ client_mode: 'none' })
  if (!result.ok) throw new Error(result.error.message)
}

describe('CloudClientGatewayAdapter negotiation and baseline', () => {
  it('maps a version-independent 426 to an update-required product failure', async () => {
    const transport = new FixtureTransport(async request => {
      expect(request.headers['Aistaff-Client-Protocol-Offer']).toBe('1.0-1.7')
      return {
        status: 426,
        headers: { 'Content-Type': 'application/vnd.aistaff.client-bootstrap-error+json' },
        body: { code: 'UPDATE_REQUIRED', retryable: false },
      }
    })

    await expect(adapter(transport).synchronize({ client_mode: 'none' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VERSION_MISMATCH', retryable: false },
    })
  })

  it('publishes one complete snapshot-bound baseline before opening the SSE cursor', async () => {
    const transport = new FixtureTransport()
    const service = adapter(transport)
    const generations: number[] = []
    service.observe(snapshot => generations.push(snapshot.view_generation))

    await synchronize(service)

    expect(service.getSnapshot()).toMatchObject({
      state: 'ready',
      view_generation: 1,
      workforce: { employees: [{ display_name: '经营分析员工 1' }] },
      engagements: [{ engagement_ref: engagementRef }],
      current_engagement: { engagement: { engagement_ref: engagementRef } },
    })
    expect(generations).toEqual([1])
    expect(transport.requests.map(item => item.operation)).toEqual([
      'clientBootstrap',
      'createProjectionSnapshot',
      'getWorkforceSnapshot',
      'listEngagements',
      'getEngagementSnapshot',
    ])

    await expect(service.readEngagement({ engagement_ref: engagementRef })).resolves.toMatchObject({
      ok: true,
      value: { engagement: { engagement_ref: engagementRef } },
    })
    expect(service.getSnapshot().view_generation).toBe(2)
    expect(generations).toEqual([1, 2])
  })
})

describe('CloudClientGatewayAdapter mutation surface', () => {
  it('exposes open, submit, interaction, material, raw content, and operation outcome without Host metadata', async () => {
    const transport = new FixtureTransport()
    const service = adapter(transport)
    await synchronize(service)
    const openInput: OpenEngagementInput = {
      operation_id: OperationId('open-1'),
      employee_ref: employeeRef,
      title: '经营分析',
    }
    const submitInput: SubmitEmployeeInput = {
      operation_id: OperationId('submit-1'),
      engagement_ref: engagementRef,
      parts: [{ kind: 'text', text: '生成分析' }],
      expected_revision: revision,
    }
    const interactionInput: InteractionResponseInput = {
      operation_id: OperationId('interaction-1'),
      interaction_ref: interactionRef,
      outcome_id: 'approve',
      expected_revision: revision,
    }
    const accessInput: MaterialAccessInput = {
      operation_id: OperationId('access-1'),
      material_ref: materialRef,
      action: 'preview',
      purpose: '用户预览',
      expected_revision: revision,
    }

    const opened = await service.openEngagement(openInput)
    const submitted = await service.submitInput(submitInput)
    const answered = await service.respondInteraction(interactionInput)
    const granted = await service.createMaterialAccess(accessInput)
    if (!granted.ok) throw new Error(granted.error.message)
    const content = await service.readMaterialContent(granted.value)
    const reconciled = await service.readOperation({ operation_id: OperationId('operation-1') })

    expect(opened).toMatchObject({ ok: true, value: { engagement_ref: engagementRef } })
    expect(submitted).toMatchObject({ ok: true, value: { activity_ref: activityRef } })
    expect(answered).toMatchObject({ ok: true, value: { receipt_ref: 'receipt-1' } })
    expect(content).toEqual({ ok: true, value: new Uint8Array([79, 75]) })
    expect(reconciled).toMatchObject({ ok: true, value: { operation_id: 'operation-1' } })
    const mutations = transport.requests.filter(item => item.method === 'POST' && item.operation !== 'clientBootstrap' && item.operation !== 'createProjectionSnapshot')
    expect(mutations.map(item => item.headers['Idempotency-Key'])).toEqual(['open-1', 'submit-1', 'interaction-1', 'access-1'])
    expect(mutations.slice(1).map(item => item.headers['If-Match'])).toEqual(['"revision-1"', '"revision-1"', '"revision-1"'])
  })

  it('reconciles a dispatched timeout through the original operation without creating a second key', async () => {
    const transport = new FixtureTransport(async (request, fixture) => {
      if (request.operation === 'submitEmployeeActivity') {
        throw new ClientGatewayTransportError('timeout', true)
      }
      if (request.operation === 'getOperation') return response(200, operationStatus(activity('working')), fixture.selectionRef)
      return defaultRequest(request, fixture)
    })
    const service = adapter(transport)
    await synchronize(service)
    const input: SubmitEmployeeInput = {
      operation_id: OperationId('operation-1'),
      engagement_ref: engagementRef,
      parts: [{ kind: 'text', text: '生成分析' }],
      expected_revision: revision,
    }

    await expect(service.submitInput(input)).resolves.toMatchObject({
      ok: true,
      value: { activity_ref: activityRef, display_state: 'working' },
    })
    const submitted = transport.requests.filter(item => item.operation === 'submitEmployeeActivity')
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.headers['Idempotency-Key']).toBe('operation-1')
    expect(transport.requests.some(item => item.path === '/api/client/operations/operation-1')).toBe(true)
  })
})

describe('CloudClientGatewayAdapter replay recovery', () => {
  it('applies a replacement once, advances over duplicate delivery, and never publishes the raw envelope', async () => {
    const changed = engagement('更新后的经营分析')
    const event: DecodedEmployeeEvent = {
      kind: 'replacement',
      eventRef: 'event-1',
      cursor: 'cursor-1-1',
      streamRef: 'stream-1',
      contractSelectionRef: 'selection-1',
      value: { type: 'engagement.changed', value: changed },
    }
    const duplicate = { ...event, cursor: 'cursor-1-2' }
    const transport = new FixtureTransport(defaultRequest, async () => ({
      status: 200,
      headers: selectedHeaders(),
      frames: frames([{ data: event }, { data: duplicate }]),
    }))
    const service = adapter(transport)
    const generations: number[] = []
    service.observe(snapshot => generations.push(snapshot.view_generation))
    await synchronize(service)

    await expect(service.consumeEvents(new AbortController().signal)).resolves.toEqual({ ok: true, value: undefined })

    expect(service.getSnapshot()).toMatchObject({
      view_generation: 2,
      engagements: [{ title: '更新后的经营分析' }],
    })
    expect(generations).toEqual([1, 2])
    expect(JSON.stringify(service.getSnapshot())).not.toContain('cursor-1-2')
  })

  it('discards the old checkpoint and rebuilds the whole projection on cursor expiry', async () => {
    const transport = new FixtureTransport(defaultRequest, async fixture => {
      void fixture
      return {
        status: 410,
        headers: selectedHeaders(),
        errorBody: { code: 'CURSOR_EXPIRED', retryable: false },
        frames: frames([]),
      }
    })
    const service = adapter(transport)
    await synchronize(service)

    await expect(service.consumeEvents(new AbortController().signal)).resolves.toEqual({ ok: true, value: undefined })

    expect(transport.baselineCount).toBe(2)
    expect(service.getSnapshot()).toMatchObject({
      view_generation: 2,
      workforce: { employees: [{ display_name: '经营分析员工 2' }] },
    })
  })

  it('re-bootstraps and creates a new baseline when the contract selection expires', async () => {
    let bootstraps = 0
    const transport = new FixtureTransport(async (request, fixture) => {
      if (request.operation === 'clientBootstrap') {
        bootstraps += 1
        fixture.selectionRef = `selection-${String(bootstraps)}`
        return response(200, selection(fixture.selectionRef), fixture.selectionRef)
      }
      return defaultRequest(request, fixture)
    }, async () => ({
      status: 410,
      headers: selectedHeaders('selection-1'),
      errorBody: { code: 'EXPIRED', retryable: true },
      frames: frames([]),
    }))
    const service = adapter(transport)
    await synchronize(service)

    await expect(service.consumeEvents(new AbortController().signal)).resolves.toEqual({ ok: true, value: undefined })

    expect(bootstraps).toBe(2)
    expect(transport.baselineCount).toBe(2)
    expect(transport.requests.at(-1)?.headers['Aistaff-Contract-Selection']).toBe('selection-2')
  })

  it('fails loudly and does not advance the cursor for an unknown non-ignorable event', async () => {
    const unknown: DecodedEmployeeEvent = {
      kind: 'unsupported',
      eventRef: 'event-unknown',
      cursor: 'cursor-1-1',
      streamRef: 'stream-1',
      contractSelectionRef: 'selection-1',
      ignorable: false,
    }
    const transport = new FixtureTransport(defaultRequest, async () => ({
      status: 200,
      headers: selectedHeaders(),
      frames: frames([{ data: unknown }]),
    }))
    const service = adapter(transport)
    await synchronize(service)

    await expect(service.consumeEvents(new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'VERSION_MISMATCH', retryable: false },
    })
    await service.consumeEvents(new AbortController().signal)

    expect(transport.subscriptions.map(item => item.path)).toEqual([
      '/api/client/event-streams/stream-1?after=cursor-1-0',
      '/api/client/event-streams/stream-1?after=cursor-1-0',
    ])
    expect(service.getSnapshot().view_generation).toBe(1)
  })
})
