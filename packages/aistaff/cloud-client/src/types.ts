/** Host-only types for the Aistaff Client Gateway adapter. */

import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperienceSnapshot,
  EmployeeWorkforceView,
  EngagementSnapshot,
  EngagementView,
  InteractionRequestView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  MaterialView,
  OpenEngagementInput,
  OperationStatusView,
  ProductError,
  SubmitEmployeeInput,
} from '@deepseek-ai/dsh-aistaff-employee-experience'

/** Headers accepted by the injected Host transport. */
export type GatewayHeaders = Readonly<Record<string, string>>

/** A raw HTTP response whose body is decoded only by the pinned artifact. */
export interface GatewayTransportResponse {
  readonly status: number
  readonly headers: GatewayHeaders
  readonly body: unknown
}

/** One raw SSE frame. The artifact validates its fields and JSON payload. */
export interface GatewaySseFrame {
  readonly id?: string
  readonly event?: string
  readonly data?: unknown
  readonly comment?: string
}

/** A bounded transport request. */
export interface GatewayTransportRequest {
  readonly operation: GatewayOperation
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly headers: GatewayHeaders
  readonly body?: unknown
  readonly signal: AbortSignal
}

/** A transport subscription established after the server validates the cursor. */
export interface GatewayTransportSubscription {
  readonly status: number
  readonly headers: GatewayHeaders
  readonly errorBody?: unknown
  readonly frames: AsyncIterable<GatewaySseFrame>
}

/** Host-side HTTP/SSE carrier. Implementations own authentication and never expose it to Renderer code. */
export interface ClientGatewayTransport {
  request(input: GatewayTransportRequest): Promise<GatewayTransportResponse>
  subscribe(input: GatewayTransportRequest): Promise<GatewayTransportSubscription>
}

/** Stable V1 Client Gateway operations implemented by this adapter. */
export type GatewayOperation =
  | 'clientBootstrap'
  | 'createProjectionSnapshot'
  | 'getWorkforceSnapshot'
  | 'listEngagements'
  | 'getEngagementSnapshot'
  | 'openEngagement'
  | 'submitEmployeeActivity'
  | 'respondInteraction'
  | 'createMaterialAccessGrant'
  | 'getMaterialContent'
  | 'getOperation'
  | 'subscribeEmployeeEvents'

/** Semantic result of bootstrap validation. */
export interface ClientGatewaySelection {
  readonly protocol: string
  readonly contractSelectionRef: string
  readonly contractSelectionExpiresAt: string
  readonly clientMode: 'none'
  readonly envelopeContract: string
  readonly identityKey: string
}

/** Snapshot lease fields used only inside the Host adapter. */
export interface ProjectionSnapshotLease {
  readonly snapshotRef: string
  readonly streamRef: string
  readonly resumeCursor: string
}

/** One semantic value bound to a projection snapshot and replay checkpoint. */
export interface SnapshotBound<T> {
  readonly value: T
  readonly snapshotRef: string
  readonly streamRef: string
  readonly resumeCursor: string
}

/** One decoded page from a single snapshot lease. */
export interface ProjectionPage<T> {
  readonly items: readonly T[]
  readonly nextCursor?: string
  readonly snapshotRef: string
  readonly streamRef: string
  readonly resumeCursor: string
  readonly ownerRevision: string
}

/** One decoded engagement detail page from the same snapshot lease. */
export interface DecodedEngagementSnapshot {
  readonly value: EngagementSnapshot
  readonly nextCursor?: string
  readonly snapshotRef: string
  readonly streamRef: string
  readonly resumeCursor: string
}

/** Inputs required to assemble one complete Renderer-safe replacement. */
export interface ProjectionBaseline {
  readonly workforce: EmployeeWorkforceView
  readonly engagements: readonly EngagementView[]
  readonly engagementSnapshots: readonly EngagementSnapshot[]
  readonly observedAt: string
  readonly previousGeneration: number
}

/** Decoded response metadata used to bind every request to the active selection. */
export interface SelectedGatewayResult<T> {
  readonly protocol: string
  readonly contractSelectionRef: string
  readonly value: T
}

/** Decoded Cloud error with no provider text or trace. */
export interface DecodedGatewayError {
  readonly code:
    | 'INVALID_REQUEST'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'EXPIRED'
    | 'CURSOR_EXPIRED'
    | 'POLICY_DENIED'
    | 'RATE_LIMITED'
    | 'UNAVAILABLE'
    | 'UPDATE_REQUIRED'
    | 'UNKNOWN_OUTCOME'
  readonly retryable: boolean
  readonly operationId?: string
}

/** Renderer-safe replacement payloads admitted from the Cloud event stream. */
export type EmployeeExperienceReplacementEvent =
  | { readonly type: 'workforce.changed'; readonly value: EmployeeWorkforceView }
  | { readonly type: 'engagement.changed'; readonly value: EngagementView }
  | { readonly type: 'activity.changed'; readonly value: ActivityView }
  | { readonly type: 'material.changed'; readonly value: MaterialView }
  | { readonly type: 'interaction.changed'; readonly value: InteractionRequestView }
  | { readonly type: 'receipt.changed'; readonly value: EffectReceiptView }

/** Result of decoding a forward-open employee event envelope. */
export type DecodedEmployeeEvent =
  | {
      readonly kind: 'replacement'
      readonly eventRef: string
      readonly cursor: string
      readonly streamRef: string
      readonly contractSelectionRef: string
      readonly value: EmployeeExperienceReplacementEvent
    }
  | {
      readonly kind: 'unsupported'
      readonly eventRef: string
      readonly cursor: string
      readonly streamRef: string
      readonly contractSelectionRef: string
      readonly ignorable: boolean
    }
  | {
      readonly kind: 'reset'
      readonly eventRef: string
      readonly cursor: string
      readonly streamRef: string
      readonly contractSelectionRef: string
    }

/** Outcome recovery result decoded with the original operation contract. */
export type RecoveredOperation<T> =
  | { readonly kind: 'resolved'; readonly value: T }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed'; readonly error: DecodedGatewayError }

/** Artifact-owned codecs and semantic projection functions. No production Schema is declared by this package. */
export interface ClientGatewayContractArtifact {
  readonly artifactVersion: string
  readonly rootHash: string
  encodeClientHello(input: unknown): unknown
  decodeBootstrap(response: GatewayTransportResponse): ClientGatewaySelection
  decodeBootstrapError(response: GatewayTransportResponse): DecodedGatewayError
  encodeCreateProjectionSnapshot(operationId: string): unknown
  decodeProjectionSnapshot(response: GatewayTransportResponse): SelectedGatewayResult<ProjectionSnapshotLease>
  decodeWorkforce(response: GatewayTransportResponse): SelectedGatewayResult<SnapshotBound<EmployeeWorkforceView>>
  decodeEngagementPage(response: GatewayTransportResponse): SelectedGatewayResult<ProjectionPage<EngagementView>>
  decodeEngagementSnapshot(response: GatewayTransportResponse): SelectedGatewayResult<DecodedEngagementSnapshot>
  mergeEngagementSnapshotPages(pages: readonly EngagementSnapshot[]): EngagementSnapshot
  encodeOpenEngagement(input: OpenEngagementInput): unknown
  decodeOpenEngagement(response: GatewayTransportResponse): SelectedGatewayResult<EngagementView>
  encodeSubmitInput(input: SubmitEmployeeInput): unknown
  decodeActivity(response: GatewayTransportResponse): SelectedGatewayResult<ActivityView>
  encodeInteractionResponse(input: InteractionResponseInput): unknown
  decodeInteractionReceipt(response: GatewayTransportResponse): SelectedGatewayResult<EffectReceiptView>
  encodeMaterialAccess(input: MaterialAccessInput): unknown
  decodeMaterialAccess(response: GatewayTransportResponse): SelectedGatewayResult<MaterialAccessGrant>
  decodeMaterialContent(response: GatewayTransportResponse, grant: MaterialAccessGrant): Uint8Array
  decodeOperation(response: GatewayTransportResponse): SelectedGatewayResult<OperationStatusView>
  recoverOperation<T>(operation: GatewayOperation, status: OperationStatusView): RecoveredOperation<T>
  decodeError(response: GatewayTransportResponse): DecodedGatewayError
  decodeEmployeeEvent(frame: GatewaySseFrame): DecodedEmployeeEvent
  composeBaseline(input: ProjectionBaseline): EmployeeExperienceSnapshot
  applyReplacement(snapshot: EmployeeExperienceSnapshot, event: EmployeeExperienceReplacementEvent): EmployeeExperienceSnapshot
  fingerprint(operation: GatewayOperation, input: unknown): string
}

/** Adapter configuration with no implicit URL, credential, protocol, or timeout. */
export interface CloudClientGatewayOptions {
  readonly protocolOffer: string
  readonly requestTimeoutMs: number
  readonly pageLimit: number
  readonly selectionRenewalSkewMs: number
  readonly clock: () => Date
  readonly createOperationId: () => string
  readonly transport: ClientGatewayTransport
  readonly artifact: ClientGatewayContractArtifact
  readonly initialSnapshot: EmployeeExperienceSnapshot
}

/** Checkpoint retained exclusively by the Host adapter. */
export interface ProjectionCheckpoint {
  readonly selectionRef: string
  readonly snapshotRef: string
  readonly streamRef: string
  readonly resumeCursor: string
}

/** Stable, display-safe mapping from decoded Cloud failures to the object layer. */
export type CloudFailureMapper = (error: DecodedGatewayError) => ProductError
