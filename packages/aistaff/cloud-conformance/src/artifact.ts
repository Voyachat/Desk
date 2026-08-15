/** Test-only Client Gateway artifact codec with fixed provenance and root hash. */

import { createHash } from 'node:crypto'
import type {
  ClientGatewayContractArtifact,
  ClientGatewaySelection,
  DecodedEmployeeEvent,
  DecodedGatewayError,
  EmployeeExperienceReplacementEvent,
  GatewayOperation,
  GatewaySseFrame,
  GatewayTransportResponse,
  ProjectionBaseline,
  ProjectionPage,
  ProjectionSnapshotLease,
  RecoveredOperation,
  SelectedGatewayResult,
  SnapshotBound,
} from '@deepseek-ai/dsh-aistaff-cloud-client'
import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperienceSnapshot,
  EmployeeWorkforceView,
  EngagementSnapshot,
  EngagementView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  OpenEngagementInput,
  OperationStatusView,
  SubmitEmployeeInput,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  ConformanceArtifactProvenance,
  FixtureEnvelope,
  FixtureErrorEnvelope,
  FixtureEventEnvelope,
  FixtureSnapshotLease,
} from './types.ts'

/** Fixed test-only artifact version. */
export const CONFORMANCE_ARTIFACT_VERSION = '0.0.0-client-gateway-conformance.1'

/** Fixed digest identifying the exact local fixture contract implementation. */
export const CONFORMANCE_ARTIFACT_ROOT_HASH = 'd9f7bce2c34f748736cac38f0f39c2911639c386e4ca96bb1f719735697f7d7a'

/** Immutable provenance carried by the fixture package. */
export const CONFORMANCE_ARTIFACT_PROVENANCE: ConformanceArtifactProvenance = Object.freeze({
  test_only: true,
  artifact_version: CONFORMANCE_ARTIFACT_VERSION,
  root_hash: CONFORMANCE_ARTIFACT_ROOT_HASH,
  source: 'AiDesktop local Client Gateway conformance fixture',
})

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

function responseHeader(response: GatewayTransportResponse, name: string): string {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  throw new TypeError(`fixture response is missing ${name}`)
}

function unwrap<T>(response: GatewayTransportResponse): SelectedGatewayResult<T> {
  const envelope = record(response.body, 'fixture response envelope') as unknown as FixtureEnvelope<T>
  if (envelope.contract !== 'aistaff.client-gateway-envelope.fixture@1.0') {
    throw new TypeError('fixture response envelope contract is invalid')
  }
  return {
    protocol: responseHeader(response, 'Aistaff-Client-Protocol'),
    contractSelectionRef: string(envelope.contract_selection_ref, 'contract_selection_ref'),
    value: envelope.data,
  }
}

function replaceBy<T, K>(values: readonly T[], next: T, keyOf: (value: T) => K, key: K): readonly T[] {
  return values.some(value => keyOf(value) === key)
    ? values.map(value => keyOf(value) === key ? next : value)
    : [...values, next]
}

function sha256Base64Url(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

function sha256Base64(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64')
}

/** Test-only artifact codec used by the in-memory conformance Gateway. */
export class ConformanceClientGatewayArtifact implements ClientGatewayContractArtifact {
  readonly artifactVersion = CONFORMANCE_ARTIFACT_VERSION
  readonly rootHash = CONFORMANCE_ARTIFACT_ROOT_HASH

  /** Encode the fixed client-mode-none semantic hello. */
  encodeClientHello(input: unknown): unknown {
    const value = record(input, 'ClientHello')
    if (value.client_mode !== 'none') throw new TypeError('fixture ClientHello requires client_mode none')
    return { client_mode: 'none' }
  }

  /** Decode the selected fixture Gateway contract. */
  decodeBootstrap(response: GatewayTransportResponse): ClientGatewaySelection {
    const value = unwrap<Record<string, unknown>>(response).value
    if (value.test_only !== true || value.client_mode !== 'none') throw new TypeError('invalid fixture bootstrap')
    return {
      protocol: string(value.protocol, 'bootstrap protocol'),
      contractSelectionRef: string(value.contract_selection_ref, 'bootstrap selection'),
      contractSelectionExpiresAt: string(value.contract_selection_expires_at, 'bootstrap expiry'),
      clientMode: 'none',
      envelopeContract: string(value.envelope_contract, 'bootstrap envelope contract'),
      identityKey: string(value.identity_key, 'bootstrap identity'),
    }
  }

  /** Decode the version-independent bootstrap error. */
  decodeBootstrapError(response: GatewayTransportResponse): DecodedGatewayError {
    const body = record(response.body, 'bootstrap error')
    const error = record(body.error, 'bootstrap error body')
    if (error.code !== 'UPDATE_REQUIRED') throw new TypeError('unexpected bootstrap error code')
    return { code: 'UPDATE_REQUIRED', retryable: false }
  }

  /** Encode one fixture snapshot lease request. */
  encodeCreateProjectionSnapshot(operationId: string): unknown {
    return { operation_id: string(operationId, 'operation_id') }
  }

  /** Decode one fixture snapshot lease. */
  decodeProjectionSnapshot(response: GatewayTransportResponse): SelectedGatewayResult<ProjectionSnapshotLease> {
    const decoded = unwrap<FixtureSnapshotLease>(response)
    return {
      ...decoded,
      value: {
        snapshotRef: decoded.value.snapshot_ref,
        streamRef: decoded.value.stream_ref,
        resumeCursor: decoded.value.resume_cursor,
      },
    }
  }

  /** Decode one snapshot-bound workforce replacement. */
  decodeWorkforce(response: GatewayTransportResponse): SelectedGatewayResult<SnapshotBound<EmployeeWorkforceView>> {
    const decoded = unwrap<Record<string, unknown>>(response)
    return {
      ...decoded,
      value: {
        value: decoded.value.workforce as EmployeeWorkforceView,
        snapshotRef: string(decoded.value.snapshot_ref, 'workforce snapshot_ref'),
        streamRef: string(decoded.value.stream_ref, 'workforce stream_ref'),
        resumeCursor: string(decoded.value.resume_cursor, 'workforce resume_cursor'),
      },
    }
  }

  /** Decode one snapshot-bound engagement page. */
  decodeEngagementPage(response: GatewayTransportResponse): SelectedGatewayResult<ProjectionPage<EngagementView>> {
    const decoded = unwrap<Record<string, unknown>>(response)
    if (!Array.isArray(decoded.value.items)) throw new TypeError('engagement page items must be an array')
    return {
      ...decoded,
      value: {
        items: decoded.value.items as EngagementView[],
        ...(decoded.value.next_cursor === undefined ? {} : { nextCursor: string(decoded.value.next_cursor, 'next_cursor') }),
        ownerRevision: string(decoded.value.owner_revision, 'owner_revision'),
        snapshotRef: string(decoded.value.snapshot_ref, 'engagement snapshot_ref'),
        streamRef: string(decoded.value.stream_ref, 'engagement stream_ref'),
        resumeCursor: string(decoded.value.resume_cursor, 'engagement resume_cursor'),
      },
    }
  }

  /** Decode one snapshot-bound engagement detail page. */
  decodeEngagementSnapshot(response: GatewayTransportResponse): ReturnType<ClientGatewayContractArtifact['decodeEngagementSnapshot']> {
    const decoded = unwrap<Record<string, unknown>>(response)
    return {
      ...decoded,
      value: {
        value: decoded.value.detail as EngagementSnapshot,
        ...(decoded.value.next_cursor === undefined ? {} : { nextCursor: string(decoded.value.next_cursor, 'next_cursor') }),
        snapshotRef: string(decoded.value.snapshot_ref, 'detail snapshot_ref'),
        streamRef: string(decoded.value.stream_ref, 'detail stream_ref'),
        resumeCursor: string(decoded.value.resume_cursor, 'detail resume_cursor'),
      },
    }
  }

  /** Merge fixture detail pages while preserving the last owner header. */
  mergeEngagementSnapshotPages(pages: readonly EngagementSnapshot[]): EngagementSnapshot {
    const first = pages[0]
    if (first === undefined) throw new TypeError('fixture engagement detail requires at least one page')
    return pages.slice(1).reduce<EngagementSnapshot>((merged, page) => ({
      engagement: page.engagement,
      activities: [...merged.activities, ...page.activities],
      materials: [...merged.materials, ...page.materials],
      interactions: [...merged.interactions, ...page.interactions],
      receipts: [...merged.receipts, ...page.receipts],
      has_more: page.has_more,
      owner_revision: page.owner_revision,
    }), first)
  }

  /** Encode an open-engagement command. */
  encodeOpenEngagement(input: OpenEngagementInput): unknown {
    return { operation_id: input.operation_id, employee_ref: input.employee_ref, ...(input.title === undefined ? {} : { title: input.title }) }
  }

  /** Decode the created engagement. */
  decodeOpenEngagement(response: GatewayTransportResponse): SelectedGatewayResult<EngagementView> {
    return unwrap(response)
  }

  /** Encode a path-bound activity command without duplicating engagement_ref. */
  encodeSubmitInput(input: SubmitEmployeeInput): unknown {
    return { operation_id: input.operation_id, parts: input.parts, expected_revision: input.expected_revision }
  }

  /** Decode an accepted activity. */
  decodeActivity(response: GatewayTransportResponse): SelectedGatewayResult<ActivityView> {
    return unwrap(response)
  }

  /** Encode a path-bound interaction response. */
  encodeInteractionResponse(input: InteractionResponseInput): unknown {
    return {
      operation_id: input.operation_id,
      outcome_id: input.outcome_id,
      ...(input.values === undefined ? {} : { values: input.values }),
      ...(input.local_consent_ref === undefined ? {} : { local_consent_ref: input.local_consent_ref }),
      expected_revision: input.expected_revision,
    }
  }

  /** Decode the interaction receipt. */
  decodeInteractionReceipt(response: GatewayTransportResponse): SelectedGatewayResult<EffectReceiptView> {
    return unwrap(response)
  }

  /** Encode a path-bound material access command. */
  encodeMaterialAccess(input: MaterialAccessInput): unknown {
    return {
      operation_id: input.operation_id,
      action: input.action,
      purpose: input.purpose,
      expected_revision: input.expected_revision,
    }
  }

  /** Decode a short-lived fixture grant. */
  decodeMaterialAccess(response: GatewayTransportResponse): SelectedGatewayResult<MaterialAccessGrant> {
    return unwrap(response)
  }

  /** Verify the fixture's complete raw content against transport and grant metadata. */
  decodeMaterialContent(response: GatewayTransportResponse, grant: MaterialAccessGrant): Uint8Array {
    if (!(response.body instanceof Uint8Array)) throw new TypeError('fixture material content must be bytes')
    const length = Number(responseHeader(response, 'Content-Length'))
    if (length !== response.body.byteLength || length !== grant.byte_size) throw new TypeError('fixture content length mismatch')
    if (sha256Base64Url(response.body) !== grant.content_hash) throw new TypeError('fixture content digest mismatch')
    if (responseHeader(response, 'Content-Digest') !== `sha-256=:${sha256Base64(response.body)}:`) {
      throw new TypeError('fixture Content-Digest header mismatch')
    }
    return response.body
  }

  /** Decode one retained operation status. */
  decodeOperation(response: GatewayTransportResponse): SelectedGatewayResult<OperationStatusView> {
    return unwrap(response)
  }

  /** Recover the original typed mutation result from its retained fixture outcome. */
  recoverOperation<T>(_operation: GatewayOperation, status: OperationStatusView): RecoveredOperation<T> {
    if (status.outcome?.kind === 'result') return { kind: 'resolved', value: status.outcome.result as T }
    if (status.outcome?.kind === 'error') {
      return {
        kind: 'failed',
        error: {
          code: status.outcome.error.code === 'CONFLICT' ? 'IDEMPOTENCY_CONFLICT' : 'UNKNOWN_OUTCOME',
          retryable: status.outcome.error.retryable,
          operationId: status.operation_id,
        },
      }
    }
    return { kind: 'pending' }
  }

  /** Decode a selected fixture error without provider text. */
  decodeError(response: GatewayTransportResponse): DecodedGatewayError {
    const envelope = record(response.body, 'fixture error') as unknown as FixtureErrorEnvelope
    return {
      code: envelope.error.code,
      retryable: envelope.error.retryable,
      ...(envelope.error.operation_id === undefined ? {} : { operationId: envelope.error.operation_id }),
    }
  }

  /** Decode and classify one strict fixture SSE frame. */
  decodeEmployeeEvent(frame: GatewaySseFrame): DecodedEmployeeEvent {
    if (frame.event !== 'employee.projection') throw new TypeError('fixture SSE event name is invalid')
    const envelope = record(frame.data, 'fixture event') as unknown as FixtureEventEnvelope
    if (frame.id !== envelope.cursor || envelope.payload_type !== envelope.payload.type) {
      throw new TypeError('fixture SSE id or payload type is invalid')
    }
    const common = {
      eventRef: envelope.event_ref,
      cursor: envelope.cursor,
      streamRef: envelope.stream_ref,
      contractSelectionRef: envelope.contract_selection_ref,
    }
    switch (envelope.payload.type) {
      case 'engagement.changed':
      case 'activity.changed':
      case 'material.changed':
      case 'interaction.changed':
      case 'receipt.changed':
        return { kind: 'replacement', ...common, value: envelope.payload }
      case 'fixture.unknown':
        return { kind: 'unsupported', ...common, ignorable: envelope.ignorable }
    }
  }

  /** Compose one complete initial Renderer replacement. */
  composeBaseline(input: ProjectionBaseline): EmployeeExperienceSnapshot {
    return {
      state: 'ready',
      workforce: input.workforce,
      engagements: input.engagements,
      has_more_engagements: false,
      current_engagement: input.engagementSnapshots[0] ?? null,
      view_generation: input.previousGeneration + 1,
      observed_at: input.observedAt,
    }
  }

  /** Apply one semantic resource replacement and increment the object-layer generation. */
  applyReplacement(snapshot: EmployeeExperienceSnapshot, event: EmployeeExperienceReplacementEvent): EmployeeExperienceSnapshot {
    const generation = snapshot.view_generation + 1
    const observed = new Date().toISOString()
    if (event.type === 'workforce.changed') {
      return { ...snapshot, workforce: event.value, view_generation: generation, observed_at: observed }
    }
    if (event.type === 'engagement.changed') {
      const engagements = replaceBy(snapshot.engagements, event.value, value => value.engagement_ref, event.value.engagement_ref)
      const current = snapshot.current_engagement === null
        ? {
            engagement: event.value,
            activities: [],
            materials: [],
            interactions: [],
            receipts: [],
            has_more: false,
            owner_revision: event.value.revision,
          }
        : snapshot.current_engagement.engagement.engagement_ref === event.value.engagement_ref
          ? { ...snapshot.current_engagement, engagement: event.value, owner_revision: event.value.revision }
          : snapshot.current_engagement
      return { ...snapshot, engagements, current_engagement: current, view_generation: generation, observed_at: observed }
    }
    const current = snapshot.current_engagement
    if (current === null) return { ...snapshot, view_generation: generation, observed_at: observed }
    switch (event.type) {
      case 'activity.changed':
        return {
          ...snapshot,
          current_engagement: {
            ...current,
            activities: replaceBy(current.activities, event.value, value => value.activity_ref, event.value.activity_ref),
          },
          view_generation: generation,
          observed_at: observed,
        }
      case 'material.changed':
        return {
          ...snapshot,
          current_engagement: {
            ...current,
            materials: replaceBy(current.materials, event.value, value => value.material_ref, event.value.material_ref),
          },
          view_generation: generation,
          observed_at: observed,
        }
      case 'interaction.changed':
        return {
          ...snapshot,
          current_engagement: {
            ...current,
            interactions: replaceBy(current.interactions, event.value, value => value.interaction_ref, event.value.interaction_ref),
          },
          view_generation: generation,
          observed_at: observed,
        }
      case 'receipt.changed':
        return {
          ...snapshot,
          current_engagement: {
            ...current,
            interactions: current.interactions.filter(value => value.interaction_ref !== event.value.subject_ref),
            receipts: replaceBy(current.receipts, event.value, value => value.receipt_ref, event.value.receipt_ref),
          },
          view_generation: generation,
          observed_at: observed,
        }
    }
  }

  /** Create a deterministic fixture fingerprint for local idempotency checks. */
  fingerprint(operation: GatewayOperation, input: unknown): string {
    return `${operation}:${JSON.stringify(input)}`
  }
}

/** Singleton fixed artifact used by the conformance plugin. */
export const CONFORMANCE_CLIENT_GATEWAY_ARTIFACT = Object.freeze(new ConformanceClientGatewayArtifact())
