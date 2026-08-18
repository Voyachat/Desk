/** Deterministic in-memory Client Gateway transport for test-only conformance. */

import { createHash } from 'node:crypto'
import { Context, Service } from '@voyaseek-ai/cordis'
import type {
  ClientGatewayTransport,
  GatewayHeaders,
  GatewaySseFrame,
  GatewayTransportRequest,
  GatewayTransportResponse,
  GatewayTransportSubscription,
} from '@voyaseek-ai/dsh-aistaff-cloud-client'
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
  type EmployeeWorkforceView,
  type EngagementView,
  type InteractionRequestView,
  type JsonValue,
  type MaterialAccessGrant,
  type MaterialView,
  type OperationStatusView,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type { InteractionRef as InteractionRefType } from '@voyaseek-ai/dsh-aistaff-employee-experience/types'
import type {
  FixtureBaseline,
  FixtureBusinessState,
  ConformanceLocalResultInput,
  ConformanceLocalResultPublication,
  ConformanceScenario,
  FixtureEnvelope,
  FixtureErrorEnvelope,
  FixtureEventEnvelope,
  FixtureEventPayload,
  FixtureOperationRecord,
  FixtureSnapshotLease,
} from './types.ts'

const PROTOCOL = '1.7'
const SELECTION_REF = 'fixture-selection-1'
const STREAM_REF = 'fixture-stream-1'
const ENVELOPE_CONTRACT = 'aistaff.client-gateway-envelope.fixture@1.0'
const EMPLOYEE_REF = EmployeeRef('fixture-employee-1')
const ENGAGEMENT_REF = EngagementRef('fixture-engagement-1')
const ACTIVITY_REF = ActivityRef('fixture-activity-1')
const MATERIAL_REF = MaterialRef('fixture-material-1')
const LOCAL_MATERIAL_REF = MaterialRef('fixture-local-material-1')
const INTERACTION_REF = InteractionRef('fixture-interaction-1')
const CONTENT = new TextEncoder().encode('分析完成')

/** Context key for deterministic conformance controls and metrics. */
export const AISTAFF_CLOUD_CONFORMANCE_CONTROL_KEY = 'aistaffCloudConformance' as const

/** Explicit fixture construction options. */
export interface InMemoryConformanceClientGatewayOptions {
  /** Business scenario; omitted preserves the V1 approval behavior. */
  readonly scenario?: ConformanceScenario
}

function header(headers: GatewayHeaders, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value as Record<string, unknown>
}

function selectedHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Aistaff-Client-Protocol': PROTOCOL,
    'Aistaff-Contract-Selection': SELECTION_REF,
    ...extra,
  }
}

function envelope<T>(data: T): FixtureEnvelope<T> {
  return { contract: ENVELOPE_CONTRACT, contract_selection_ref: SELECTION_REF, data }
}

function selectedResponse<T>(status: number, data: T, extraHeaders: Record<string, string> = {}): GatewayTransportResponse {
  return { status, headers: selectedHeaders(extraHeaders), body: envelope(data) }
}

function errorResponse(status: number, code: FixtureErrorEnvelope['error']['code'], retryable = false, operationId?: string): GatewayTransportResponse {
  return {
    status,
    headers: selectedHeaders(),
    body: {
      contract_selection_ref: SELECTION_REF,
      error: { code, retryable, ...(operationId === undefined ? {} : { operation_id: operationId }) },
    } satisfies FixtureErrorEnvelope,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function validateLocalResult(input: ConformanceLocalResultInput): void {
  if (input.payload.kind === 'file') {
    const bytes = new TextEncoder().encode(input.payload.text).byteLength
    if (bytes > 8_192 || input.payload.media_type.trim().length === 0) {
      throw new TypeError('fixture local file result exceeds its admitted bounds')
    }
    return
  }
  if (input.payload.entries.length > 256) {
    throw new TypeError('fixture local directory result exceeds its admitted bounds')
  }
  for (const entry of input.payload.entries) {
    const invalidName = entry.name.length === 0 || entry.name === '.' || entry.name === '..'
      || entry.name.includes('/') || entry.name.includes('\\') || entry.name.includes('\0')
    const invalidSize = entry.size_bytes !== undefined
      && (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0)
    if (invalidName || invalidSize) throw new TypeError('fixture local directory entry is invalid')
  }
  if (new TextEncoder().encode(JSON.stringify(input.payload.entries)).byteLength > 8_192) {
    throw new TypeError('fixture local directory result exceeds its admitted bounds')
  }
}

function cursor(index: number): string {
  return `fixture-cursor-${String(index).padStart(6, '0')}`
}

function cursorIndex(value: string): number | undefined {
  const match = /^fixture-cursor-(\d{6})$/.exec(value)
  if (match?.[1] === undefined) return undefined
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function sha256Base64Url(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

function sha256Base64(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64')
}

function pathRef(path: string, expression: RegExp, label: string): string {
  const match = expression.exec(path)
  if (match?.[1] === undefined) throw new TypeError(`fixture ${label} path is invalid`)
  return decodeURIComponent(match[1])
}

function queryParameter(path: string, name: string): string | undefined {
  const queryIndex = path.indexOf('?')
  if (queryIndex < 0) return undefined
  for (const field of path.slice(queryIndex + 1).split('&')) {
    const separator = field.indexOf('=')
    const rawKey = separator < 0 ? field : field.slice(0, separator)
    if (decodeURIComponent(rawKey) !== name) continue
    return decodeURIComponent(separator < 0 ? '' : field.slice(separator + 1))
  }
  return undefined
}

function revision(value: number): ReturnType<typeof OwnerRevision> {
  return OwnerRevision(`fixture-revision-${String(value).padStart(4, '0')}`)
}

function workforce(): EmployeeWorkforceView {
  return {
    revision: revision(1),
    observed_at: '2026-08-15T00:00:00.000Z',
    employees: [{
      employee_ref: EMPLOYEE_REF,
      display_name: '云端经营分析员工',
      role_label: '经营分析师',
      description: '测试专用 Client Gateway conformance 员工',
      availability: 'ready',
      capability_labels: ['经营分析'],
      allowed_actions: { open: { allowed: true } },
    }],
  }
}

function operationOutcome(operationId: string, action: string, value: unknown, valueRevision: ReturnType<typeof OwnerRevision>): OperationStatusView {
  return {
    operation_id: OperationId(operationId),
    action,
    state: 'succeeded',
    outcome: {
      kind: 'result',
      result_contract: {
        name: `fixture.${action}`,
        major: 1,
        minor: 0,
        schema_ref: `fixture/${action}`,
        schema_hash: `fixture-${action}-schema-hash`,
      },
      result: clone(value) as JsonValue,
      result_hash: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    },
    revision: valueRevision,
    updated_at: new Date().toISOString(),
  }
}

/** In-memory Gateway implementing the fixed test-only Client Gateway scenario. */
export class InMemoryConformanceClientGateway implements ClientGatewayTransport {
  private revisionCounter = 1
  private snapshotCounter = 0
  private eventCounter = 0
  private disconnectEpoch = 0
  private duplicateNext = false
  private expireNext = false
  private duplicateDeliveries = 0
  private localResultCommits = 0
  private readonly eventLog: FixtureEventEnvelope[] = []
  private readonly leases = new Map<string, { lease: FixtureSnapshotLease; baseline: FixtureBaseline }>()
  private readonly snapshotOperations = new Map<string, FixtureSnapshotLease>()
  private readonly wakeWaiters = new Set<() => void>()
  private readonly subscriptionCursors: string[] = []
  private readonly state: FixtureBusinessState = {
    workforce: workforce(),
    engagements: [],
    details: new Map(),
    materials: new Map(),
    interactions: new Map(),
    operations: new Map(),
    localResultPublications: new Map(),
  }
  private readonly scenario: ConformanceScenario

  /**
   * Create one isolated deterministic Gateway.
   * @param options - explicit scenario selection; approval is the compatibility default.
   */
  constructor(options: InMemoryConformanceClientGatewayOptions = {}) {
    this.scenario = options.scenario ?? 'approval'
  }

  /** Active immutable business scenario. */
  get activeScenario(): ConformanceScenario {
    return this.scenario
  }

  /** Number of snapshot leases created, including cursor-expired rebuilds. */
  get snapshotLeaseCount(): number {
    return this.snapshotCounter
  }

  /** Exclusive cursors used by every SSE subscription in order. */
  get subscribedAfterCursors(): readonly string[] {
    return [...this.subscriptionCursors]
  }

  /** Number of deliberate duplicate frames delivered. */
  get duplicateDeliveryCount(): number {
    return this.duplicateDeliveries
  }

  /** Number of canonical local result commits, excluding idempotent replays. */
  get localResultCommitCount(): number {
    return this.localResultCommits
  }

  /** Make the next delivered business event appear twice with the same event_ref. */
  duplicateNextEvent(): void {
    this.duplicateNext = true
  }

  /** Make the next subscribe attempt return `410 CURSOR_EXPIRED`. */
  expireNextSubscription(): void {
    this.expireNext = true
  }

  /** Cleanly end all current streams so the provider reconnects from its checkpoint. */
  disconnectActiveStreams(): void {
    this.disconnectEpoch += 1
    this.wakeStreams()
  }

  /**
   * Add one unknown event for focused forward-compatibility tests.
   * @param ignorable - whether a newer consumer may safely skip the event.
   */
  emitUnknownEvent(ignorable: boolean): void {
    this.appendEvent({ type: 'fixture.unknown', value: { marker: 'unknown' } }, ignorable)
  }

  /**
   * Resolve one current authoritative local-operation interaction.
   * @param interactionRef - opaque interaction identity.
   * @returns a detached current request or null after completion/removal.
   */
  resolveCurrentLocalOperation(interactionRef: string): Extract<InteractionRequestView, { readonly kind: 'local_operation' }> | null {
    const interaction = this.state.interactions.get(interactionRef)
    return interaction?.kind === 'local_operation' ? clone(interaction) : null
  }

  /**
   * Idempotently commit one bounded path-free local result into the authoritative Cloud projection.
   * @param input - original operation, current interaction revision, and admitted bounded payload.
   * @returns canonical Material and Cloud Receipt identities.
   */
  publishLocalResult(input: ConformanceLocalResultInput): ConformanceLocalResultPublication {
    const fingerprint = JSON.stringify(input)
    const prior = this.state.localResultPublications.get(input.operation_id)
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) throw new TypeError('fixture local result operation conflicts with retained input')
      return clone(prior.publication)
    }
    const interaction = this.state.interactions.get(input.interaction_ref)
    if (interaction?.kind !== 'local_operation') throw new TypeError('fixture local operation is not current')
    if (interaction.revision !== input.interaction_revision) throw new TypeError('fixture local operation revision changed')
    const detail = this.state.details.get(interaction.engagement_ref)
    const activity = detail?.activities.find(value => value.activity_ref === interaction.activity_ref)
    if (detail === undefined || activity === undefined) throw new TypeError('fixture local operation activity is unavailable')
    validateLocalResult(input)
    const createdAt = new Date().toISOString()
    const body: MaterialView['body'] = input.payload.kind === 'directory'
      ? {
          kind: 'structured',
          schema_ref: 'fixture.directory-list@1',
          value: { entries: clone(input.payload.entries) },
        }
      : { kind: 'text', format: 'plain_text', text: input.payload.text }
    const material: MaterialView = {
      material_ref: LOCAL_MATERIAL_REF,
      engagement_ref: interaction.engagement_ref,
      activity_ref: interaction.activity_ref,
      title: input.payload.kind === 'directory' ? '本机目录列表' : '本机文本内容',
      summary: 'test_only：本机只读结果已由 Cloud fixture owner 接收。',
      body,
      presentation: 'inline',
      state: 'available',
      allowed_actions: {},
      revision: this.nextRevision(),
      created_at: createdAt,
    }
    const receipt: EffectReceiptView = {
      receipt_ref: ReceiptRef('fixture-local-cloud-receipt-1'),
      subject_ref: interaction.interaction_ref,
      status: 'succeeded',
      effect_state: 'none',
      result_material_refs: [material.material_ref],
      revision: this.nextRevision(),
      recorded_at: createdAt,
    }
    const succeeded: ActivityView = {
      ...activity,
      display_state: 'succeeded',
      material_refs: [material.material_ref],
      interaction_refs: [],
      revision: this.nextRevision(),
      updated_at: createdAt,
    }
    this.state.materials.set(material.material_ref, material)
    this.state.interactions.delete(interaction.interaction_ref)
    this.state.details.set(interaction.engagement_ref, {
      ...detail,
      activities: [succeeded],
      materials: [...detail.materials.filter(value => value.material_ref !== material.material_ref), material],
      interactions: detail.interactions.filter(value => value.interaction_ref !== interaction.interaction_ref),
      receipts: [...detail.receipts.filter(value => value.receipt_ref !== receipt.receipt_ref), receipt],
      owner_revision: succeeded.revision,
    })
    const publication: ConformanceLocalResultPublication = {
      material_refs: [material.material_ref],
      receipt,
    }
    this.state.localResultPublications.set(input.operation_id, { fingerprint, publication: clone(publication) })
    this.localResultCommits += 1
    this.appendEvent({ type: 'material.changed', value: material })
    this.appendEvent({ type: 'receipt.changed', value: receipt })
    this.appendEvent({ type: 'activity.changed', value: succeeded })
    return clone(publication)
  }

  /** Execute one deterministic fixture HTTP operation. */
  async request(input: GatewayTransportRequest): Promise<GatewayTransportResponse> {
    if (input.operation === 'clientBootstrap') return this.bootstrap(input)
    const selectionFailure = this.validateSelection(input)
    if (selectionFailure !== undefined) return selectionFailure
    switch (input.operation) {
      case 'createProjectionSnapshot': return this.createSnapshot(input)
      case 'getWorkforceSnapshot': return this.getWorkforce(input)
      case 'listEngagements': return this.listEngagements(input)
      case 'getEngagementSnapshot': return this.getEngagement(input)
      case 'openEngagement': return this.openEngagement(input)
      case 'submitEmployeeActivity': return this.submitActivity(input)
      case 'respondInteraction': return this.respondInteraction(input)
      case 'createMaterialAccessGrant': return this.createMaterialAccess(input)
      case 'getMaterialContent': return this.getMaterialContent(input)
      case 'getOperation': return this.getOperation(input)
      case 'subscribeEmployeeEvents': throw new TypeError('fixture SSE must use subscribe()')
    }
  }

  /** Establish one strict SSE replay subscription. */
  async subscribe(input: GatewayTransportRequest): Promise<GatewayTransportSubscription> {
    const selectionFailure = this.validateSelection(input)
    if (selectionFailure !== undefined) {
      return { status: selectionFailure.status, headers: selectionFailure.headers, errorBody: selectionFailure.body, frames: this.emptyFrames() }
    }
    const streamRef = pathRef(input.path, /^\/api\/client\/event-streams\/([^?]+)\?/, 'event stream')
    if (streamRef !== STREAM_REF) {
      const failure = errorResponse(404, 'NOT_FOUND')
      return { status: failure.status, headers: failure.headers, errorBody: failure.body, frames: this.emptyFrames() }
    }
    const after = queryParameter(input.path, 'after')
    if (after === undefined || after.length === 0) throw new TypeError('fixture subscription requires after cursor')
    this.subscriptionCursors.push(after)
    if (this.expireNext) {
      this.expireNext = false
      const failure = errorResponse(410, 'CURSOR_EXPIRED')
      return { status: 410, headers: failure.headers, errorBody: failure.body, frames: this.emptyFrames() }
    }
    const index = cursorIndex(after)
    if (index === undefined || index > this.eventLog.length) {
      const failure = errorResponse(410, 'CURSOR_EXPIRED')
      return { status: 410, headers: failure.headers, errorBody: failure.body, frames: this.emptyFrames() }
    }
    return {
      status: 200,
      headers: {
        ...selectedHeaders(),
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
      },
      frames: this.streamFrames(index, input.signal, this.disconnectEpoch),
    }
  }

  private bootstrap(input: GatewayTransportRequest): GatewayTransportResponse {
    const offer = header(input.headers, 'Aistaff-Client-Protocol-Offer')
    if (offer === undefined || !offer.split(',').some(range => range.trim().startsWith('1.'))) {
      return {
        status: 426,
        headers: { 'Content-Type': 'application/vnd.aistaff.client-bootstrap-error+json' },
        body: { error: { code: 'UPDATE_REQUIRED', retryable: false } },
      }
    }
    const hello = object(input.body, 'fixture ClientHello')
    if (hello.client_mode !== 'none') return errorResponse(400, 'INVALID_REQUEST')
    return selectedResponse(200, {
      test_only: true,
      protocol: PROTOCOL,
      contract_selection_ref: SELECTION_REF,
      contract_selection_expires_at: '2099-01-01T00:00:00.000Z',
      client_mode: 'none',
      envelope_contract: 'aistaff.employee-event-envelope.fixture@1.0',
      identity_key: 'fixture-issuer/fixture-tenant/fixture-subject/fixture-device/revision-1',
    })
  }

  private validateSelection(input: GatewayTransportRequest): GatewayTransportResponse | undefined {
    if (header(input.headers, 'Aistaff-Client-Protocol') !== PROTOCOL
      || header(input.headers, 'Aistaff-Contract-Selection') !== SELECTION_REF) {
      return errorResponse(410, 'EXPIRED', true)
    }
    return undefined
  }

  private createSnapshot(input: GatewayTransportRequest): GatewayTransportResponse {
    const body = object(input.body, 'snapshot request')
    const operationId = this.requireIdempotency(input, body)
    const existing = this.snapshotOperations.get(operationId)
    if (existing !== undefined) return selectedResponse(200, existing, { 'Idempotency-Replayed': 'true' })
    this.snapshotCounter += 1
    const lease: FixtureSnapshotLease = {
      snapshot_ref: `fixture-snapshot-${String(this.snapshotCounter)}`,
      stream_ref: STREAM_REF,
      resume_cursor: cursor(this.eventLog.length),
    }
    this.snapshotOperations.set(operationId, lease)
    this.leases.set(lease.snapshot_ref, {
      lease,
      baseline: {
        workforce: clone(this.state.workforce),
        engagements: clone(this.state.engagements),
        details: clone(Array.from(this.state.details.values())),
      },
    })
    return selectedResponse(200, lease)
  }

  private getWorkforce(input: GatewayTransportRequest): GatewayTransportResponse {
    const lease = this.leaseFromUrl(input.path)
    if (lease === undefined) return errorResponse(410, 'CURSOR_EXPIRED')
    return selectedResponse(200, {
      workforce: clone(lease.baseline.workforce),
      snapshot_ref: lease.lease.snapshot_ref,
      stream_ref: lease.lease.stream_ref,
      resume_cursor: lease.lease.resume_cursor,
    })
  }

  private listEngagements(input: GatewayTransportRequest): GatewayTransportResponse {
    const lease = this.leaseFromUrl(input.path)
    if (lease === undefined) return errorResponse(410, 'CURSOR_EXPIRED')
    return selectedResponse(200, {
      items: clone(lease.baseline.engagements),
      owner_revision: lease.baseline.engagements.at(-1)?.revision ?? lease.baseline.workforce.revision,
      snapshot_ref: lease.lease.snapshot_ref,
      stream_ref: lease.lease.stream_ref,
      resume_cursor: lease.lease.resume_cursor,
    })
  }

  private getEngagement(input: GatewayTransportRequest): GatewayTransportResponse {
    const lease = this.leaseFromUrl(input.path)
    if (lease === undefined) return errorResponse(410, 'CURSOR_EXPIRED')
    const engagementRef = pathRef(input.path, /^\/api\/client\/engagements\/([^?]+)\?/, 'engagement')
    const detail = lease.baseline.details.find(value => value.engagement.engagement_ref === engagementRef)
    if (detail === undefined) return errorResponse(404, 'NOT_FOUND')
    return selectedResponse(200, {
      detail: clone(detail),
      snapshot_ref: lease.lease.snapshot_ref,
      stream_ref: lease.lease.stream_ref,
      resume_cursor: lease.lease.resume_cursor,
    })
  }

  private openEngagement(input: GatewayTransportRequest): GatewayTransportResponse {
    return this.idempotentMutation(input, 'openEngagement', (body, operationId) => {
      if (body.employee_ref !== EMPLOYEE_REF) return { error: errorResponse(404, 'NOT_FOUND') }
      const existing = this.state.engagements[0]
      const value = existing ?? {
        engagement_ref: ENGAGEMENT_REF,
        employee_ref: EMPLOYEE_REF,
        title: typeof body.title === 'string' && body.title.length > 0 ? body.title : '经营分析',
        display_state: 'ready',
        revision: this.nextRevision(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } satisfies EngagementView
      if (existing === undefined) {
        this.state.engagements.push(value)
        this.state.details.set(value.engagement_ref, {
          engagement: value,
          activities: [],
          materials: [],
          interactions: [],
          receipts: [],
          has_more: false,
          owner_revision: value.revision,
        })
        this.appendEvent({ type: 'engagement.changed', value })
      }
      return { status: 201, value, outcome: operationOutcome(operationId, 'openEngagement', value, value.revision) }
    })
  }

  private submitActivity(input: GatewayTransportRequest): GatewayTransportResponse {
    const engagementRef = pathRef(input.path, /^\/api\/client\/engagements\/([^/]+)\/activities$/, 'activity engagement')
    return this.idempotentMutation(input, 'submitEmployeeActivity', (body, operationId) => {
      const detail = this.state.details.get(engagementRef)
      if (detail === undefined) return { error: errorResponse(404, 'NOT_FOUND') }
      if (body.expected_revision !== detail.engagement.revision
        || header(input.headers, 'If-Match') !== `"${detail.engagement.revision}"`) {
        return { error: errorResponse(412, 'REVISION_CONFLICT') }
      }
      if (!Array.isArray(body.parts) || body.parts.length !== 1) return { error: errorResponse(400, 'INVALID_REQUEST') }
      const part = object(body.parts[0], 'fixture input part')
      if (part.kind !== 'text' || typeof part.text !== 'string' || part.text.trim().length === 0) {
        return { error: errorResponse(400, 'INVALID_REQUEST') }
      }
      const createdAt = new Date().toISOString()
      const queued: ActivityView = {
        activity_ref: ACTIVITY_REF,
        engagement_ref: ENGAGEMENT_REF,
        employee_ref: EMPLOYEE_REF,
        display_state: 'queued',
        material_refs: [],
        interaction_refs: [],
        revision: this.nextRevision(),
        created_at: createdAt,
        updated_at: createdAt,
      }
      if (this.scenario === 'local_read') {
        const interaction: InteractionRequestView = {
          kind: 'local_operation',
          interaction_ref: INTERACTION_REF,
          engagement_ref: ENGAGEMENT_REF,
          activity_ref: ACTIVITY_REF,
          title: 'test_only：读取本机客户资料目录',
          summary: '选择一个目录，仅列出其直接子项；路径不会发送到 Cloud fixture。',
          allowed_outcome_ids: ['deny', 'cancel'],
          revision: this.nextRevision(),
          expires_at: '2099-01-01T00:00:00.000Z',
          capability_ref: 'directory/list',
          operation: 'directory/list',
          argument_schema_ref: 'fixture.directory-list.arguments@1',
          arguments: { relative_segments: [], max_bytes: 4096 },
          risk: 'medium',
          effect_class: 'none',
          resource_requirements: [{
            slot_ref: 'customer-directory',
            resource_kind: 'directory',
            access: 'read',
            scope_constraint_ref: 'fixture.direct-children',
            scope_constraint_hash: 'sha256:fixture-direct-children',
          }],
          consent_required: true,
        }
        const waiting: ActivityView = {
          ...queued,
          display_state: 'waiting_user',
          interaction_refs: [INTERACTION_REF],
          revision: this.nextRevision(),
          updated_at: new Date().toISOString(),
        }
        this.state.interactions.set(interaction.interaction_ref, interaction)
        this.state.details.set(engagementRef, {
          ...detail,
          activities: [waiting],
          materials: [],
          interactions: [interaction],
          owner_revision: waiting.revision,
        })
        this.appendEvent({ type: 'activity.changed', value: queued })
        this.appendEvent({ type: 'interaction.changed', value: interaction })
        this.appendEvent({ type: 'activity.changed', value: waiting })
        return { status: 202, value: queued, outcome: operationOutcome(operationId, 'submitEmployeeActivity', queued, queued.revision) }
      }
      const material: MaterialView = {
        material_ref: MATERIAL_REF,
        engagement_ref: ENGAGEMENT_REF,
        activity_ref: ACTIVITY_REF,
        title: '经营分析结果',
        summary: `已处理：${part.text}`,
        body: { kind: 'text', format: 'markdown', text: '分析完成' },
        presentation: 'inline',
        state: 'available',
        allowed_actions: { preview: { allowed: true }, download: { allowed: true } },
        revision: this.nextRevision(),
        created_at: createdAt,
      }
      const interaction: InteractionRequestView = {
        kind: 'approval',
        interaction_ref: INTERACTION_REF,
        engagement_ref: ENGAGEMENT_REF,
        activity_ref: ACTIVITY_REF,
        title: '确认分析结果',
        summary: '是否确认本次经营分析结果？',
        allowed_outcome_ids: ['approve', 'reject'],
        revision: this.nextRevision(),
        risk: 'low',
        owner: 'cloud',
      }
      const waiting: ActivityView = {
        ...queued,
        display_state: 'waiting_user',
        material_refs: [MATERIAL_REF],
        interaction_refs: [INTERACTION_REF],
        revision: this.nextRevision(),
        updated_at: new Date().toISOString(),
      }
      this.state.materials.set(material.material_ref, material)
      this.state.interactions.set(interaction.interaction_ref, interaction)
      this.state.details.set(engagementRef, {
        ...detail,
        activities: [waiting],
        materials: [material],
        interactions: [interaction],
        owner_revision: waiting.revision,
      })
      this.appendEvent({ type: 'activity.changed', value: queued })
      this.appendEvent({ type: 'material.changed', value: material })
      this.appendEvent({ type: 'interaction.changed', value: interaction })
      this.appendEvent({ type: 'activity.changed', value: waiting })
      return { status: 202, value: queued, outcome: operationOutcome(operationId, 'submitEmployeeActivity', queued, queued.revision) }
    })
  }

  private respondInteraction(input: GatewayTransportRequest): GatewayTransportResponse {
    const interactionRef = pathRef(input.path, /^\/api\/client\/interactions\/([^/]+)\/responses$/, 'interaction')
    return this.idempotentMutation(input, 'respondInteraction', (body, operationId) => {
      const interaction = this.state.interactions.get(interactionRef)
      if (interaction === undefined) return { error: errorResponse(404, 'NOT_FOUND') }
      if (body.expected_revision !== interaction.revision
        || header(input.headers, 'If-Match') !== `"${interaction.revision}"`) {
        return { error: errorResponse(412, 'REVISION_CONFLICT') }
      }
      if (body.outcome_id !== 'approve') return { error: errorResponse(400, 'INVALID_REQUEST') }
      const detail = this.state.details.get(interaction.engagement_ref)
      const current = detail?.activities.find(value => value.activity_ref === interaction.activity_ref)
      if (detail === undefined || current === undefined) return { error: errorResponse(404, 'NOT_FOUND') }
      const receipt: EffectReceiptView = {
        receipt_ref: ReceiptRef('fixture-receipt-1'),
        subject_ref: interaction.interaction_ref,
        status: 'succeeded',
        effect_state: 'none',
        result_material_refs: [MATERIAL_REF],
        revision: this.nextRevision(),
        recorded_at: new Date().toISOString(),
      }
      const succeeded: ActivityView = {
        ...current,
        display_state: 'succeeded',
        revision: this.nextRevision(),
        updated_at: new Date().toISOString(),
      }
      this.state.interactions.delete(interaction.interaction_ref)
      this.state.details.set(interaction.engagement_ref, {
        ...detail,
        activities: [succeeded],
        interactions: detail.interactions.filter(value => value.interaction_ref !== interaction.interaction_ref),
        receipts: [receipt],
        owner_revision: succeeded.revision,
      })
      this.appendEvent({ type: 'receipt.changed', value: receipt })
      this.appendEvent({ type: 'activity.changed', value: succeeded })
      return { status: 200, value: receipt, outcome: operationOutcome(operationId, 'respondInteraction', receipt, receipt.revision) }
    })
  }

  private createMaterialAccess(input: GatewayTransportRequest): GatewayTransportResponse {
    const materialRef = pathRef(input.path, /^\/api\/client\/materials\/([^/]+)\/access-grants$/, 'material')
    return this.idempotentMutation(input, 'createMaterialAccessGrant', (body, operationId) => {
      const material = this.state.materials.get(materialRef)
      if (material === undefined) return { error: errorResponse(404, 'NOT_FOUND') }
      if (body.expected_revision !== material.revision
        || header(input.headers, 'If-Match') !== `"${material.revision}"`
        || body.action !== 'preview') {
        return { error: errorResponse(412, 'REVISION_CONFLICT') }
      }
      const grant: MaterialAccessGrant = {
        grant_ref: MaterialAccessGrantRef('fixture-grant-1'),
        material_ref: MATERIAL_REF,
        action: 'preview',
        content_ref: ContentRef('fixture-content-1'),
        media_type: 'text/plain; charset=utf-8',
        byte_size: CONTENT.byteLength,
        content_hash: sha256Base64Url(CONTENT),
        display_filename: 'analysis.txt',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }
      return { status: 201, value: grant, outcome: operationOutcome(operationId, 'createMaterialAccessGrant', grant, material.revision) }
    })
  }

  private getMaterialContent(input: GatewayTransportRequest): GatewayTransportResponse {
    const grantRef = pathRef(input.path, /^\/api\/client\/material-access-grants\/([^/]+)\/content$/, 'material grant')
    if (grantRef !== 'fixture-grant-1') return errorResponse(404, 'NOT_FOUND')
    return {
      status: 200,
      headers: selectedHeaders({
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': String(CONTENT.byteLength),
        'Content-Digest': `sha-256=:${sha256Base64(CONTENT)}:`,
      }),
      body: clone(CONTENT),
    }
  }

  private getOperation(input: GatewayTransportRequest): GatewayTransportResponse {
    const operationId = pathRef(input.path, /^\/api\/client\/operations\/([^/]+)$/, 'operation')
    const operation = this.state.operations.get(operationId)
    return operation === undefined ? errorResponse(404, 'NOT_FOUND') : selectedResponse(200, operation.outcome)
  }

  private idempotentMutation(
    input: GatewayTransportRequest,
    action: string,
    execute: (body: Record<string, unknown>, operationId: string) =>
      | { readonly error: GatewayTransportResponse }
      | { readonly status: number; readonly value: FixtureOperationRecord['value']; readonly outcome: OperationStatusView },
  ): GatewayTransportResponse {
    const body = object(input.body, `${action} body`)
    const operationId = this.requireIdempotency(input, body)
    const fingerprint = `${input.method}:${input.path}:${JSON.stringify(body)}`
    const existing = this.state.operations.get(operationId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) return errorResponse(409, 'IDEMPOTENCY_CONFLICT', false, operationId)
      return selectedResponse(existing.status, clone(existing.value), { 'Idempotency-Replayed': 'true' })
    }
    const executed = execute(body, operationId)
    if ('error' in executed) return executed.error
    const record: FixtureOperationRecord = {
      fingerprint,
      status: executed.status,
      value: clone(executed.value),
      outcome: clone(executed.outcome),
    }
    this.state.operations.set(operationId, record)
    return selectedResponse(record.status, record.value)
  }

  private requireIdempotency(input: GatewayTransportRequest, body: Record<string, unknown>): string {
    const bodyId = body.operation_id
    const headerId = header(input.headers, 'Idempotency-Key')
    if (typeof bodyId !== 'string' || bodyId.length === 0 || headerId !== bodyId) {
      throw new TypeError('fixture operation_id must equal Idempotency-Key')
    }
    return bodyId
  }

  private leaseFromUrl(path: string): { lease: FixtureSnapshotLease; baseline: FixtureBaseline } | undefined {
    const snapshotRef = queryParameter(path, 'snapshot_ref')
    return snapshotRef === undefined ? undefined : this.leases.get(snapshotRef)
  }

  private nextRevision(): ReturnType<typeof OwnerRevision> {
    this.revisionCounter += 1
    return revision(this.revisionCounter)
  }

  private appendEvent(payload: FixtureEventPayload, ignorable = false): void {
    this.eventCounter += 1
    const next: FixtureEventEnvelope = {
      envelope_contract: 'aistaff.employee-event-envelope.fixture@1.0',
      payload_contract: `fixture.${payload.type}@1.0`,
      contract_selection_ref: SELECTION_REF,
      stream_ref: STREAM_REF,
      event_ref: `fixture-event-${String(this.eventCounter)}`,
      cursor: cursor(this.eventLog.length + 1),
      payload_type: payload.type,
      ignorable,
      occurred_at: new Date().toISOString(),
      payload: clone(payload),
    }
    this.eventLog.push(next)
    this.wakeStreams()
  }

  private async *streamFrames(index: number, signal: AbortSignal, epoch: number): AsyncIterable<GatewaySseFrame> {
    let offset = index
    while (!signal.aborted && epoch === this.disconnectEpoch) {
      while (offset < this.eventLog.length) {
        const event = this.eventLog[offset]
        if (event === undefined) break
        offset += 1
        const frame = { id: event.cursor, event: 'employee.projection', data: clone(event) }
        yield frame
        if (this.duplicateNext) {
          this.duplicateNext = false
          this.duplicateDeliveries += 1
          yield clone(frame)
        }
      }
      if (signal.aborted || epoch !== this.disconnectEpoch) return
      await this.waitForStreamChange(signal, epoch)
    }
  }

  private waitForStreamChange(signal: AbortSignal, epoch: number): Promise<void> {
    if (signal.aborted || epoch !== this.disconnectEpoch) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        signal.removeEventListener('abort', done)
        this.wakeWaiters.delete(done)
        resolve()
      }
      this.wakeWaiters.add(done)
      signal.addEventListener('abort', done, { once: true })
    })
  }

  private wakeStreams(): void {
    const waiters = Array.from(this.wakeWaiters)
    this.wakeWaiters.clear()
    for (const wake of waiters) wake()
  }

  private async *emptyFrames(): AsyncIterable<never> {}
}

/** Host service exposing only deterministic test controls and metrics. */
export class AistaffCloudConformanceControl extends Service {
  /**
   * @param ctx - test composition context.
   * @param gateway - owned in-memory Gateway.
   */
  constructor(ctx: Context, readonly gateway: InMemoryConformanceClientGateway) {
    super(ctx, AISTAFF_CLOUD_CONFORMANCE_CONTROL_KEY)
  }

  /** Active immutable business scenario. */
  get scenario(): ConformanceScenario { return this.gateway.activeScenario }
  /** Number of canonical local result commits, excluding idempotent replays. */
  get localResultCommitCount(): number { return this.gateway.localResultCommitCount }

  /** Duplicate the next delivered event frame. */
  duplicateNextEvent(): void { this.gateway.duplicateNextEvent() }
  /** Expire the next SSE subscription before stream establishment. */
  expireNextSubscription(): void { this.gateway.expireNextSubscription() }
  /** End all active streams and trigger provider reconnect. */
  disconnectActiveStreams(): void { this.gateway.disconnectActiveStreams() }
  /**
   * Emit an unknown event for a focused compatibility assertion.
   * @param ignorable - whether a newer consumer may safely skip the event.
   */
  emitUnknownEvent(ignorable: boolean): void { this.gateway.emitUnknownEvent(ignorable) }

  /**
   * Resolve one current authoritative local-operation interaction.
   * @param interactionRef - opaque interaction identity.
   * @returns a detached current request or null after completion/removal.
   */
  resolveCurrentLocalOperation(
    interactionRef: InteractionRefType,
  ): Extract<InteractionRequestView, { readonly kind: 'local_operation' }> | null {
    return this.gateway.resolveCurrentLocalOperation(interactionRef)
  }

  /**
   * Publish one admitted bounded local result into the authoritative Cloud state.
   * @param input - exact interaction revision, original operation, and path-free payload.
   * @returns retained canonical Material and Cloud Receipt identities.
   */
  publishLocalResult(input: ConformanceLocalResultInput): ConformanceLocalResultPublication {
    return this.gateway.publishLocalResult(input)
  }
}

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Test-only in-memory Client Gateway controls. */
    aistaffCloudConformance: AistaffCloudConformanceControl
  }
}
