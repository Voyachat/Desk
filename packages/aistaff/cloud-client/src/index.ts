/** Host-only Aistaff Client Gateway adapter and Employee Experience provider. */

import { Context } from '@deepseek-ai/cordis'
import {
  EmployeeExperienceObjectLayer,
  EngagementRef,
  OperationId,
  OwnerRevision,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  ActivityView,
  EffectReceiptView,
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
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import { CloudClientGatewayError, ClientGatewayTransportError } from './errors.ts'
import type {
  ClientGatewaySelection,
  CloudClientGatewayOptions,
  DecodedGatewayError,
  GatewayHeaders,
  GatewayOperation,
  GatewayTransportRequest,
  GatewayTransportResponse,
  ProjectionCheckpoint,
  ProjectionSnapshotLease,
  RecoveredOperation,
  SelectedGatewayResult,
} from './types.ts'

export * from './errors.ts'
export type * from './types.ts'

const PROTOCOL_HEADER = 'Aistaff-Client-Protocol'
const OFFER_HEADER = 'Aistaff-Client-Protocol-Offer'
const SELECTION_HEADER = 'Aistaff-Contract-Selection'
const IDEMPOTENCY_HEADER = 'Idempotency-Key'

type EngagementRefType = ReturnType<typeof EngagementRef>
type OperationIdType = ReturnType<typeof OperationId>
type OwnerRevisionType = ReturnType<typeof OwnerRevision>

class RemoteFailure extends Error {
  constructor(readonly value: DecodedGatewayError) {
    super(`Client Gateway rejected request with ${value.code}`)
  }
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

function header(headers: GatewayHeaders, name: string): string | undefined {
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

function validateOptions(options: CloudClientGatewayOptions): void {
  const offerBytes = new TextEncoder().encode(options.protocolOffer).byteLength
  if (offerBytes === 0 || offerBytes > 512 || options.protocolOffer.split(',').length > 16) {
    throw new TypeError('protocolOffer must contain 1-16 ranges within 512 bytes')
  }
  if (!Number.isSafeInteger(options.requestTimeoutMs) || options.requestTimeoutMs <= 0) {
    throw new TypeError('requestTimeoutMs must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.pageLimit) || options.pageLimit <= 0) {
    throw new TypeError('pageLimit must be a positive safe integer')
  }
  if (!Number.isSafeInteger(options.selectionRenewalSkewMs) || options.selectionRenewalSkewMs < 0) {
    throw new TypeError('selectionRenewalSkewMs must be a non-negative safe integer')
  }
  if (options.artifact.artifactVersion.length === 0 || options.artifact.rootHash.length === 0) {
    throw new TypeError('a pinned contract artifact version and root hash are required')
  }
}

function assertSelectionHeaders(response: GatewayTransportResponse, selection: ClientGatewaySelection): void {
  if (header(response.headers, PROTOCOL_HEADER) !== selection.protocol
    || header(response.headers, SELECTION_HEADER) !== selection.contractSelectionRef) {
    throw new CloudClientGatewayError('PROTOCOL', 'Client Gateway selection headers do not match the decoded selection')
  }
}

/**
 * Production Host provider for the Renderer-safe Employee Experience service.
 * The injected artifact exclusively owns wire validation and the injected
 * transport exclusively owns URL resolution, credentials, and DPoP headers.
 */
export class CloudClientGatewayAdapter extends EmployeeExperienceObjectLayer {
  private selection: ClientGatewaySelection | undefined
  private checkpoint: ProjectionCheckpoint | undefined
  private clientHello: unknown
  private engagementOwnerRevision: OwnerRevisionType | undefined
  private readonly engagementSnapshots = new Map<string, EngagementSnapshot>()
  private readonly seenEventRefs = new Set<string>()
  private readonly operationFingerprints = new Map<string, string>()

  /**
   * @param ctx - Host context that owns the Employee Experience service.
   * @param options - explicit transport, artifact, timing, paging, and initial state.
   */
  constructor(ctx: Context, private readonly options: CloudClientGatewayOptions) {
    validateOptions(options)
    super(ctx, options.initialSnapshot)
  }

  /**
   * Read the current complete Renderer-safe replacement without Host recovery metadata.
   * @returns the exact immutable snapshot currently published by the object layer.
   */
  getSnapshot(): EmployeeExperienceSnapshot {
    return this.currentSnapshot()
  }

  /**
   * Negotiate a contract selection and atomically replace the full Cloud projection.
   * @param clientHello - semantic hello encoded by the pinned artifact.
   * @returns the published replacement or a display-safe failure.
   */
  synchronize(clientHello: unknown): Promise<ProductResult<EmployeeExperienceSnapshot>> {
    return this.capture(async () => {
      this.clientHello = clientHello
      await this.ensureSelection(clientHello, false)
      return this.rebuildProjection()
    })
  }

  /**
   * Consume one SSE connection from the committed exclusive cursor. A clean
   * stream end returns so the Host can reconnect with the same checkpoint.
   * @param signal - Host lifecycle cancellation; never received from Renderer DTOs.
   * @returns success after a clean stream end, or a display-safe failure.
   */
  consumeEvents(signal: AbortSignal): Promise<ProductResult<void>> {
    return this.capture(async () => {
      await this.ensureReadySelection()
      await this.consumeEventStream(signal)
    })
  }

  /**
   * Read a local page from the current complete replacement.
   * @param input - zero-based local offset and bounded page size.
   * @returns the detached page without snapshot or stream identifiers.
   */
  override async listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    if (!Number.isSafeInteger(input.offset) || input.offset < 0 || !Number.isSafeInteger(input.limit) || input.limit <= 0) {
      return { ok: false, error: this.localError('INVALID_REQUEST', '协作列表分页参数无效。', false) }
    }
    const revision = this.engagementOwnerRevision
    if (revision === undefined) {
      return { ok: false, error: this.localError('UNAVAILABLE', '云端协作列表尚未完成同步。', true) }
    }
    const snapshot = this.currentSnapshot()
    const items = snapshot.engagements.slice(input.offset, input.offset + input.limit)
    return {
      ok: true,
      value: {
        items,
        offset: input.offset,
        has_more: input.offset + items.length < snapshot.engagements.length || snapshot.has_more_engagements,
        revision,
      },
    }
  }

  /**
   * Open one collaboration through the selected Gateway contract.
   * @param input - idempotent collaboration request.
   * @returns the decoded collaboration or a display-safe failure.
   */
  override openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    return this.capture(() => this.mutate(
      'openEngagement',
      '/api/client/engagements',
      input.operation_id,
      input,
      this.options.artifact.encodeOpenEngagement(input),
      201,
      response => this.options.artifact.decodeOpenEngagement(response),
    ))
  }

  /**
   * Read one fully staged collaboration detail from the Host projection.
   * @param input - selected opaque collaboration identity.
   * @returns the complete detail without Cloud cursor metadata.
   */
  override async readEngagement(input: { readonly engagement_ref: EngagementRefType }): Promise<ProductResult<EngagementSnapshot>> {
    const value = this.engagementSnapshots.get(input.engagement_ref)
    if (value === undefined) {
      return { ok: false, error: this.localError('NOT_FOUND', '当前投影中没有该协作。', false) }
    }
    const current = this.currentSnapshot()
    this.publishReplacement({
      ...current,
      current_engagement: value,
      view_generation: current.view_generation + 1,
      observed_at: this.options.clock().toISOString(),
    })
    return { ok: true, value: this.currentSnapshot().current_engagement! }
  }

  /**
   * Submit one visible employee activity using the original operation id and revision.
   * @param input - Renderer-safe employee input.
   * @returns the accepted activity or a display-safe failure.
   */
  override submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    return this.capture(() => this.mutate(
      'submitEmployeeActivity',
      `/api/client/engagements/${encodePath(input.engagement_ref)}/activities`,
      input.operation_id,
      input,
      this.options.artifact.encodeSubmitInput(input),
      202,
      response => this.options.artifact.decodeActivity(response),
      input.expected_revision,
    ))
  }

  /**
   * Commit one interaction response exactly once.
   * @param input - owner outcome and optional Host-issued local consent.
   * @returns the owner receipt or a display-safe failure.
   */
  override respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    return this.capture(() => this.mutate(
      'respondInteraction',
      `/api/client/interactions/${encodePath(input.interaction_ref)}/responses`,
      input.operation_id,
      input,
      this.options.artifact.encodeInteractionResponse(input),
      200,
      response => this.options.artifact.decodeInteractionReceipt(response),
      input.expected_revision,
    ))
  }

  /**
   * Request a short-lived material access grant.
   * @param input - requested material action and owner revision.
   * @returns controlled access metadata or a display-safe failure.
   */
  override createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    return this.capture(() => this.mutate(
      'createMaterialAccessGrant',
      `/api/client/materials/${encodePath(input.material_ref)}/access-grants`,
      input.operation_id,
      input,
      this.options.artifact.encodeMaterialAccess(input),
      201,
      response => this.options.artifact.decodeMaterialAccess(response),
      input.expected_revision,
    ))
  }

  /**
   * Read raw material bytes through a previously issued access grant.
   * The artifact verifies content metadata and digest before returning bytes.
   * @param grant - exact short-lived grant returned by createMaterialAccess.
   * @returns verified bytes or a display-safe failure.
   */
  readMaterialContent(grant: MaterialAccessGrant): Promise<ProductResult<Uint8Array>> {
    return this.capture(async () => {
      await this.ensureReadySelection()
      const response = await this.request({
        operation: 'getMaterialContent',
        method: 'GET',
        path: `/api/client/material-access-grants/${encodePath(grant.grant_ref)}/content`,
        headers: this.selectedHeaders(),
      }, false)
      if (response.status !== 200) throw new RemoteFailure(this.options.artifact.decodeError(response))
      this.assertActiveResponseHeaders(response)
      return this.options.artifact.decodeMaterialContent(response, grant)
    })
  }

  /**
   * Reconcile one original idempotent operation without generating a new id.
   * @param input - original operation identity.
   * @returns retained operation status or a display-safe failure.
   */
  override readOperation(input: { readonly operation_id: OperationIdType }): Promise<ProductResult<OperationStatusView>> {
    return this.capture(() => this.readOperationValue(input.operation_id))
  }

  private async ensureSelection(clientHello: unknown, force: boolean): Promise<void> {
    const active = this.selection
    if (!force && active !== undefined && !this.selectionNeedsRenewal(active)) return
    const response = await this.request({
      operation: 'clientBootstrap',
      method: 'POST',
      path: '/api/client/bootstrap',
      headers: { [OFFER_HEADER]: this.options.protocolOffer },
      body: this.options.artifact.encodeClientHello(clientHello),
    }, false)
    if (response.status !== 200) throw new RemoteFailure(this.options.artifact.decodeBootstrapError(response))
    const next = this.options.artifact.decodeBootstrap(response)
    if (next.clientMode !== 'none') {
      throw new CloudClientGatewayError('PROTOCOL', 'V1 Cloud adapter accepts only client_mode none')
    }
    assertSelectionHeaders(response, next)
    if (active !== undefined && (active.identityKey !== next.identityKey
      || active.contractSelectionRef !== next.contractSelectionRef)) {
      this.clearRecoveryState()
    }
    this.selection = next
  }

  private async ensureReadySelection(): Promise<void> {
    if (this.clientHello === undefined) {
      throw new CloudClientGatewayError('PROTOCOL', 'Client Gateway must synchronize before business operations')
    }
    const active = this.selection
    if (active === undefined || this.selectionNeedsRenewal(active)) {
      await this.ensureSelection(this.clientHello, true)
      await this.rebuildProjection()
    }
  }

  private selectionNeedsRenewal(selection: ClientGatewaySelection): boolean {
    const expiresAt = Date.parse(selection.contractSelectionExpiresAt)
    if (!Number.isFinite(expiresAt)) {
      throw new CloudClientGatewayError('PROTOCOL', 'Contract selection expiry is not a valid timestamp')
    }
    return this.options.clock().getTime() + this.options.selectionRenewalSkewMs >= expiresAt
  }

  private async rebuildProjection(): Promise<EmployeeExperienceSnapshot> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.rebuildProjectionOnce()
      } catch (error) {
        lastError = error
        if (!(error instanceof RemoteFailure)) throw error
        if (error.value.code === 'CURSOR_EXPIRED') continue
        if (error.value.code === 'EXPIRED' && this.clientHello !== undefined) {
          await this.ensureSelection(this.clientHello, true)
          continue
        }
        throw error
      }
    }
    throw lastError
  }

  private async rebuildProjectionOnce(): Promise<EmployeeExperienceSnapshot> {
    const selection = this.requireSelection()
    const operationId = this.options.createOperationId()
    const leaseResponse = await this.request({
      operation: 'createProjectionSnapshot',
      method: 'POST',
      path: '/api/client/projection-snapshots',
      headers: {
        ...this.selectedHeaders(),
        [IDEMPOTENCY_HEADER]: operationId,
      },
      body: this.options.artifact.encodeCreateProjectionSnapshot(operationId),
    }, true)
    if (leaseResponse.status !== 200) throw new RemoteFailure(this.options.artifact.decodeError(leaseResponse))
    const leaseResult = this.bind(this.options.artifact.decodeProjectionSnapshot(leaseResponse), leaseResponse)
    const lease = leaseResult.value

    const workforceResponse = await this.read(
      'getWorkforceSnapshot',
      `/api/client/workforce?snapshot_ref=${encodePath(lease.snapshotRef)}`,
    )
    const workforce = this.bind(this.options.artifact.decodeWorkforce(workforceResponse), workforceResponse).value
    this.assertLease(lease, workforce)

    const engagements: EngagementView[] = []
    let nextCursor: string | undefined
    let ownerRevision: string | undefined
    const seenPageCursors = new Set<string>()
    do {
      const cursorQuery = nextCursor === undefined ? '' : `&cursor=${encodePath(nextCursor)}`
      const pageResponse = await this.read(
        'listEngagements',
        `/api/client/engagements?snapshot_ref=${encodePath(lease.snapshotRef)}&limit=${String(this.options.pageLimit)}${cursorQuery}`,
      )
      const page = this.bind(this.options.artifact.decodeEngagementPage(pageResponse), pageResponse).value
      this.assertLease(lease, page)
      if (ownerRevision !== undefined && ownerRevision !== page.ownerRevision) {
        throw new CloudClientGatewayError('PROTOCOL', 'Engagement page owner revision changed within one snapshot')
      }
      ownerRevision = page.ownerRevision
      engagements.push(...page.items)
      nextCursor = page.nextCursor
      if (nextCursor !== undefined && !seenPageCursors.add(nextCursor)) {
        throw new CloudClientGatewayError('PROTOCOL', 'Engagement pagination repeated an opaque cursor')
      }
    } while (nextCursor !== undefined)

    const details = new Map<string, EngagementSnapshot>()
    for (const engagement of engagements) {
      const pages: EngagementSnapshot[] = []
      let detailCursor: string | undefined
      let detailOwnerRevision: string | undefined
      const seenDetailCursors = new Set<string>()
      do {
        const cursorQuery = detailCursor === undefined ? '' : `&cursor=${encodePath(detailCursor)}`
        const detailResponse = await this.read(
          'getEngagementSnapshot',
          `/api/client/engagements/${encodePath(engagement.engagement_ref)}?snapshot_ref=${encodePath(lease.snapshotRef)}&limit=${String(this.options.pageLimit)}${cursorQuery}`,
        )
        const detail = this.bind(this.options.artifact.decodeEngagementSnapshot(detailResponse), detailResponse).value
        this.assertLease(lease, detail)
        if (detailOwnerRevision !== undefined && detailOwnerRevision !== detail.value.owner_revision) {
          throw new CloudClientGatewayError('PROTOCOL', 'Engagement detail owner revision changed within one snapshot')
        }
        detailOwnerRevision = detail.value.owner_revision
        pages.push(detail.value)
        detailCursor = detail.nextCursor
        if (detailCursor !== undefined && !seenDetailCursors.add(detailCursor)) {
          throw new CloudClientGatewayError('PROTOCOL', 'Engagement detail pagination repeated an opaque cursor')
        }
      } while (detailCursor !== undefined)
      details.set(engagement.engagement_ref, this.options.artifact.mergeEngagementSnapshotPages(pages))
    }

    const replacement = this.options.artifact.composeBaseline({
      workforce: workforce.value,
      engagements,
      engagementSnapshots: Array.from(details.values()),
      observedAt: this.options.clock().toISOString(),
      previousGeneration: this.currentSnapshot().view_generation,
    })
    this.publishReplacement(replacement)
    this.engagementSnapshots.clear()
    for (const [key, value] of details) this.engagementSnapshots.set(key, value)
    this.engagementOwnerRevision = ownerRevision as typeof this.engagementOwnerRevision
    this.checkpoint = {
      selectionRef: selection.contractSelectionRef,
      snapshotRef: lease.snapshotRef,
      streamRef: lease.streamRef,
      resumeCursor: lease.resumeCursor,
    }
    this.seenEventRefs.clear()
    return this.currentSnapshot()
  }

  private async consumeEventStream(signal: AbortSignal): Promise<void> {
    const selection = this.requireSelection()
    const checkpoint = this.requireCheckpoint()
    const subscription = await this.subscribe({
      operation: 'subscribeEmployeeEvents',
      method: 'GET',
      path: `/api/client/event-streams/${encodePath(checkpoint.streamRef)}?after=${encodePath(checkpoint.resumeCursor)}`,
      headers: this.selectedHeaders(),
      signal,
    })
    if (subscription.status !== 200) {
      const response = {
        status: subscription.status,
        headers: subscription.headers,
        body: subscription.errorBody,
      }
      const error = this.options.artifact.decodeError(response)
      if (error.code === 'CURSOR_EXPIRED') {
        await this.rebuildProjection()
        return
      }
      if (error.code === 'EXPIRED') {
        await this.ensureSelection(this.clientHello, true)
        await this.rebuildProjection()
        return
      }
      throw new RemoteFailure(error)
    }
    this.assertActiveResponseHeaders({ status: 200, headers: subscription.headers, body: undefined })
    for await (const frame of subscription.frames) {
      if (signal.aborted) throw new CloudClientGatewayError('ABORTED', 'Client Gateway event subscription was cancelled')
      if (frame.comment !== undefined && frame.data === undefined) continue
      if (this.selectionNeedsRenewal(selection)) {
        await this.ensureSelection(this.clientHello, true)
        await this.rebuildProjection()
        return
      }
      const event = this.options.artifact.decodeEmployeeEvent(frame)
      if (event.contractSelectionRef !== checkpoint.selectionRef || event.streamRef !== checkpoint.streamRef) {
        throw new CloudClientGatewayError('PROTOCOL', 'Employee event does not match the committed Host checkpoint')
      }
      if (event.kind === 'reset') {
        await this.ensureSelection(this.clientHello, true)
        await this.rebuildProjection()
        return
      }
      if (event.kind === 'unsupported') {
        if (!event.ignorable) {
          throw new CloudClientGatewayError('VERSION_MISMATCH', 'Cloud sent an unknown non-ignorable employee event')
        }
        this.advanceCheckpoint(event.cursor)
        continue
      }
      if (this.seenEventRefs.has(event.eventRef)) {
        this.advanceCheckpoint(event.cursor)
        continue
      }
      const replacement = this.options.artifact.applyReplacement(this.currentSnapshot(), event.value)
      this.publishReplacement(replacement)
      if (replacement.current_engagement !== null) {
        this.engagementSnapshots.set(replacement.current_engagement.engagement.engagement_ref, replacement.current_engagement)
      }
      this.seenEventRefs.add(event.eventRef)
      this.advanceCheckpoint(event.cursor)
    }
  }

  private async mutate<T>(
    operation: GatewayOperation,
    path: string,
    operationId: OperationIdType,
    semanticInput: unknown,
    body: unknown,
    expectedStatus: number,
    decode: (response: GatewayTransportResponse) => SelectedGatewayResult<T>,
    expectedRevision?: string,
  ): Promise<T> {
    await this.ensureReadySelection()
    this.reserveOperation(operation, operationId, semanticInput)
    const headers: Record<string, string> = {
      ...this.selectedHeaders(),
      [IDEMPOTENCY_HEADER]: operationId,
    }
    if (expectedRevision !== undefined) headers['If-Match'] = `"${expectedRevision}"`
    let response: GatewayTransportResponse
    try {
      response = await this.request({ operation, method: 'POST', path, headers, body }, true)
    } catch (error) {
      if (error instanceof ClientGatewayTransportError && error.requestDispatched) {
        return this.reconcileMutation<T>(operation, operationId)
      }
      throw error
    }
    if (response.status === expectedStatus) return this.bind(decode(response), response).value
    const failure = this.options.artifact.decodeError(response)
    if (failure.code === 'UNKNOWN_OUTCOME' || failure.code === 'IDEMPOTENCY_CONFLICT') {
      return this.reconcileMutation<T>(operation, operationId)
    }
    throw new RemoteFailure(failure)
  }

  private async reconcileMutation<T>(operation: GatewayOperation, operationId: OperationIdType): Promise<T> {
    const status = await this.readOperationValue(operationId)
    const recovered: RecoveredOperation<T> = this.options.artifact.recoverOperation(operation, status)
    if (recovered.kind === 'resolved') return recovered.value
    if (recovered.kind === 'failed') throw new RemoteFailure(recovered.error)
    throw new CloudClientGatewayError('UNKNOWN_OUTCOME', 'Cloud operation outcome still requires reconciliation', operationId)
  }

  private async readOperationValue(operationId: OperationIdType): Promise<OperationStatusView> {
    await this.ensureReadySelection()
    const response = await this.read('getOperation', `/api/client/operations/${encodePath(operationId)}`)
    if (response.status !== 200) throw new RemoteFailure(this.options.artifact.decodeError(response))
    return this.bind(this.options.artifact.decodeOperation(response), response).value
  }

  private reserveOperation(operation: GatewayOperation, operationId: string, input: unknown): void {
    const fingerprint = this.options.artifact.fingerprint(operation, input)
    const existing = this.operationFingerprints.get(operationId)
    if (existing !== undefined && existing !== fingerprint) {
      throw new RemoteFailure({ code: 'IDEMPOTENCY_CONFLICT', retryable: false, operationId })
    }
    this.operationFingerprints.set(operationId, fingerprint)
  }

  private async read(operation: GatewayOperation, path: string): Promise<GatewayTransportResponse> {
    const response = await this.request({ operation, method: 'GET', path, headers: this.selectedHeaders() }, false)
    if (response.status < 200 || response.status >= 300) throw new RemoteFailure(this.options.artifact.decodeError(response))
    return response
  }

  private bind<T>(result: SelectedGatewayResult<T>, response: GatewayTransportResponse): SelectedGatewayResult<T> {
    const selection = this.requireSelection()
    if (result.protocol !== selection.protocol || result.contractSelectionRef !== selection.contractSelectionRef) {
      throw new CloudClientGatewayError('PROTOCOL', 'Decoded response does not match the active contract selection')
    }
    this.assertActiveResponseHeaders(response)
    return result
  }

  private assertLease(
    lease: ProjectionSnapshotLease,
    value: { readonly snapshotRef: string; readonly streamRef: string; readonly resumeCursor: string },
  ): void {
    if (value.snapshotRef !== lease.snapshotRef || value.streamRef !== lease.streamRef || value.resumeCursor !== lease.resumeCursor) {
      throw new CloudClientGatewayError('PROTOCOL', 'Projection baseline mixed snapshot or replay checkpoint values')
    }
  }

  private assertActiveResponseHeaders(response: GatewayTransportResponse): void {
    assertSelectionHeaders(response, this.requireSelection())
  }

  private selectedHeaders(): Record<string, string> {
    const selection = this.requireSelection()
    return {
      [PROTOCOL_HEADER]: selection.protocol,
      [SELECTION_HEADER]: selection.contractSelectionRef,
    }
  }

  private requireSelection(): ClientGatewaySelection {
    if (this.selection === undefined) {
      throw new CloudClientGatewayError('PROTOCOL', 'Client Gateway has no active contract selection')
    }
    return this.selection
  }

  private requireCheckpoint(): ProjectionCheckpoint {
    if (this.checkpoint === undefined) {
      throw new CloudClientGatewayError('PROTOCOL', 'Client Gateway has no committed projection checkpoint')
    }
    return this.checkpoint
  }

  private advanceCheckpoint(resumeCursor: string): void {
    const checkpoint = this.requireCheckpoint()
    this.checkpoint = { ...checkpoint, resumeCursor }
  }

  private clearRecoveryState(): void {
    this.checkpoint = undefined
    this.engagementOwnerRevision = undefined
    this.engagementSnapshots.clear()
    this.seenEventRefs.clear()
  }

  private async request(
    input: Omit<GatewayTransportRequest, 'signal'>,
    mayHaveSideEffect: boolean,
  ): Promise<GatewayTransportResponse> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.options.requestTimeoutMs)
    try {
      return await this.options.transport.request({ ...input, signal: controller.signal })
    } catch (error) {
      if (error instanceof ClientGatewayTransportError) throw error
      if (timedOut) throw new ClientGatewayTransportError('timeout', mayHaveSideEffect)
      if (controller.signal.aborted) throw new ClientGatewayTransportError('aborted', mayHaveSideEffect)
      throw new ClientGatewayTransportError('network', mayHaveSideEffect)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async subscribe(input: GatewayTransportRequest): ReturnType<CloudClientGatewayOptions['transport']['subscribe']> {
    if (input.signal.aborted) throw new CloudClientGatewayError('ABORTED', 'Client Gateway event subscription was cancelled')
    try {
      return await this.options.transport.subscribe(input)
    } catch (error) {
      if (error instanceof ClientGatewayTransportError) throw error
      if (input.signal.aborted) throw new CloudClientGatewayError('ABORTED', 'Client Gateway event subscription was cancelled')
      throw new ClientGatewayTransportError('network', false)
    }
  }

  private async capture<T>(operation: () => Promise<T>): Promise<ProductResult<T>> {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      return { ok: false, error: this.mapError(error) }
    }
  }

  private mapError(error: unknown): ProductError {
    if (error instanceof RemoteFailure) return this.remoteProductError(error.value)
    if (error instanceof ClientGatewayTransportError) {
      const code = error.kind === 'timeout' ? 'UNAVAILABLE' : error.kind === 'aborted' ? 'UNAVAILABLE' : 'UNAVAILABLE'
      return this.localError(code, error.kind === 'timeout' ? '云端请求超时。' : '云端连接不可用。', true)
    }
    if (error instanceof CloudClientGatewayError) {
      if (error.code === 'UNKNOWN_OUTCOME') {
        return this.localError('UNKNOWN_OUTCOME', '操作结果尚不明确，需要使用原操作编号对账。', false, error.operationId)
      }
      if (error.code === 'VERSION_MISMATCH' || error.code === 'PROTOCOL') {
        return this.localError('VERSION_MISMATCH', '客户端与云端协议不兼容，需要更新后重试。', false)
      }
      if (error.code === 'EXPIRED') return this.localError('EXPIRED', '云端选择或操作已过期。', true)
      return this.localError('UNAVAILABLE', '云端连接暂不可用。', error.code !== 'ABORTED')
    }
    return this.localError('UNAVAILABLE', '云端适配器无法完成该操作。', false)
  }

  private remoteProductError(error: DecodedGatewayError): ProductError {
    const code: ProductError['code'] = (() => {
      switch (error.code) {
        case 'INVALID_REQUEST': return 'INVALID_REQUEST'
        case 'UNAUTHENTICATED': return 'UNAUTHENTICATED'
        case 'FORBIDDEN': return 'FORBIDDEN'
        case 'POLICY_DENIED': return 'DENIED'
        case 'NOT_FOUND': return 'NOT_FOUND'
        case 'REVISION_CONFLICT':
        case 'IDEMPOTENCY_CONFLICT': return 'CONFLICT'
        case 'EXPIRED':
        case 'CURSOR_EXPIRED': return 'EXPIRED'
        case 'UPDATE_REQUIRED': return 'VERSION_MISMATCH'
        case 'RATE_LIMITED':
        case 'UNAVAILABLE': return 'UNAVAILABLE'
        case 'UNKNOWN_OUTCOME': return 'UNKNOWN_OUTCOME'
      }
    })()
    return this.localError(code, this.safeMessage(code), error.retryable, error.operationId)
  }

  private safeMessage(code: ProductError['code']): string {
    switch (code) {
      case 'INVALID_REQUEST': return '请求内容无效。'
      case 'UNAUTHENTICATED': return '请重新登录后再试。'
      case 'FORBIDDEN': return '当前账号无权执行该操作。'
      case 'DENIED': return '企业策略拒绝了该操作。'
      case 'NOT_FOUND': return '请求的云端资源不存在或不可见。'
      case 'CONFLICT': return '云端状态已变化，请刷新后重新确认。'
      case 'EXPIRED': return '云端选择、游标或操作已过期。'
      case 'VERSION_MISMATCH': return '客户端版本与云端协议不兼容。'
      case 'UNAVAILABLE': return '云端服务暂不可用。'
      case 'UNKNOWN_OUTCOME': return '操作结果尚不明确，需要对账。'
    }
    throw new CloudClientGatewayError('PROTOCOL', 'Unknown product error code')
  }

  private localError(
    code: ProductError['code'],
    message: string,
    retryable: boolean,
    operationId?: string,
  ): ProductError {
    return {
      code,
      message,
      retryable,
      ...(operationId === undefined ? {} : { operation_id: OperationId(operationId) }),
    }
  }
}

export default CloudClientGatewayAdapter
