/**
 * Renderer-safe local capability Service Definition and observable object layer.
 * @module @deepseek-ai/dsh-aistaff-local-capability
 */

import { Context } from '@deepseek-ai/cordis'
import {
  LocalConsentRef,
  LocalResourceHandleRef,
  OwnerRevision,
  ReceiptRef,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalOperationRequestView,
  OperationId as OperationIdType,
  OperationStatusView,
  ProductError,
  ProductResult,
  ReceiptRef as ReceiptRefType,
  OwnerRevision as OwnerRevisionType,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import {
  SupervisorControlError,
  type SupervisorControlPort,
  SupervisorOperationId,
} from '@deepseek-ai/dsh-aistaff-supervisor-control'
import type {
  ReadCapabilityRequest,
  SupervisorGrant,
  SupervisorReceipt,
  SupervisorSubjectBinding,
} from '@deepseek-ai/dsh-aistaff-supervisor-control/types'
import type {
  AuthoritativeLocalOperation,
  AuthorizeLocalOperationInput,
  HostDirectorySelector,
  LocalCapabilityCoordinatorOptions,
  LocalCapabilityReceiptView,
  LocalCapabilityResultSink,
  LocalCapabilitySnapshot,
  LocalConsentView,
  LocalOperationInteractionResolver,
  LocalResourceView,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from './types.ts'
import { LocalCapabilityObjectLayer, LocalCapabilityPort } from './object-layer.ts'

export type * from './types.ts'
export * from './object-layer.ts'

/** Required Host dependencies for the local capability coordinator. */
export interface LocalCapabilityCoordinatorInputs {
  /** Current authoritative interaction and verified subject resolver. */
  readonly interactions: LocalOperationInteractionResolver
  /** Trusted native directory chooser. */
  readonly directory_selector: HostDirectorySelector
  /** Host owner that publishes bounded results as canonical Materials. */
  readonly result_sink: LocalCapabilityResultSink
  /** Host-only Supervisor control provider. */
  readonly supervisor: SupervisorControlPort
  /** Explicit deployment limits and time source. */
  readonly options: LocalCapabilityCoordinatorOptions
}

interface GrantBinding {
  readonly interaction_ref: string
  readonly slot_ref: string
  readonly subject: SupervisorSubjectBinding
  readonly supervisor_grant: SupervisorGrant
  readonly resource_kind: 'directory'
}

interface OperationRecord {
  readonly fingerprint: string
  promise: Promise<ProductResult<unknown>>
  status: OperationStatusView
}

interface ReadSpec {
  readonly intent: string
  readonly relative_segments: readonly string[]
  readonly max_bytes: number
}

/**
 * Host coordinator that derives every privileged request from current
 * authoritative state and publishes only complete Renderer-safe replacements.
 */
export class LocalCapabilityCoordinator extends LocalCapabilityObjectLayer {
  private readonly grants = new Map<string, GrantBinding>()
  private readonly operations = new Map<string, OperationRecord>()
  private readonly operationReceiptRefs = new Map<string, ReceiptRefType>()

  private constructor(
    ctx: Context,
    private readonly inputs: LocalCapabilityCoordinatorInputs,
  ) {
    super(ctx, {
      state: 'ready',
      resources: [],
      consents: [],
      receipts: [],
      view_generation: 0,
      observed_at: inputs.options.now().toISOString(),
    })
  }

  /**
   * Validate required Host dependencies before registering the Cordis service.
   * @param ctx - Host Cordis context.
   * @param inputs - authoritative resolver, selector, result owner, Supervisor, and limits.
   * @returns a registered local capability coordinator.
   */
  static create(ctx: Context, inputs: LocalCapabilityCoordinatorInputs): LocalCapabilityCoordinator {
    requirePositiveInteger(inputs.options.grant_lifetime_ms, 'grant_lifetime_ms')
    requirePositiveInteger(inputs.options.max_read_bytes, 'max_read_bytes')
    requirePositiveInteger(inputs.options.read_timeout_ms, 'read_timeout_ms')
    const now = inputs.options.now()
    if (!Number.isFinite(now.getTime())) throw new TypeError('local capability now() must return a valid Date')
    return new LocalCapabilityCoordinator(ctx, inputs)
  }

  /** @inheritdoc */
  override selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    const fingerprint = fingerprintOf('selectDirectory', input)
    return this.executeIdempotent(
      input.operation_id,
      fingerprint,
      'selectDirectory',
      input.interaction_ref,
      async () => this.selectDirectoryOnce(input),
    )
  }

  /** @inheritdoc */
  override authorizeLocalOperation(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    const fingerprint = fingerprintOf('authorizeLocalOperation', input)
    return this.executeIdempotent(
      input.operation_id,
      fingerprint,
      'authorizeLocalOperation',
      input.interaction_ref,
      async () => this.authorizeLocalOperationOnce(input),
      value => value.receipt_ref,
    )
  }

  /** @inheritdoc */
  override revokeResource(input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>> {
    const fingerprint = fingerprintOf('revokeResource', input)
    return this.executeIdempotent(
      input.operation_id,
      fingerprint,
      'revokeResource',
      input.grant_handle,
      async () => this.revokeResourceOnce(input),
      value => value.receipt_ref,
    )
  }

  /** @inheritdoc */
  override async readOperation(
    input: { readonly operation_id: OperationIdType },
  ): Promise<ProductResult<OperationStatusView>> {
    this.expireResources()
    const local = this.operations.get(input.operation_id)
    if (local !== undefined) {
      return { ok: true, value: local.status }
    }
    try {
      const status = await this.inputs.supervisor.readOperation({
        operation_id: SupervisorOperationId(input.operation_id),
      })
      const receipt = status.receipt_ref === undefined ? {} : { receipt_ref: ReceiptRef(status.receipt_ref) }
      return {
        ok: true,
        value: {
          operation_id: input.operation_id,
          action: 'localCapability',
          state: status.state,
          ...receipt,
          revision: OwnerRevision(status.updated_at),
          updated_at: status.updated_at,
        },
      }
    } catch (error) {
      return { ok: false, error: productError(error, input.operation_id) }
    }
  }

  private async selectDirectoryOnce(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    this.expireResources()
    const resolved = await this.resolveCurrent(input.interaction_ref)
    if (!resolved.ok) return resolved
    const requirement = resolved.value.request.resource_requirements.find(item => item.slot_ref === input.slot_ref)
    if (requirement === undefined) return failure('NOT_FOUND', '本地资源槽已不存在。', false)
    if (requirement.resource_kind !== 'directory' || requirement.access !== 'read') {
      return failure('DENIED', '当前本地资源槽不允许选择只读目录。', false)
    }
    if (!isReadOnlyOperation(resolved.value.request)) {
      return failure('DENIED', '当前本地操作不属于允许的只读能力。', false)
    }

    const selection = await this.inputs.directory_selector.selectDirectory({
      interaction: resolved.value.request,
      slot_ref: input.slot_ref,
    })
    if (selection === null) return { ok: true, value: { state: 'cancelled' } }

    const expiresAt = grantExpiry(resolved.value.request, this.inputs.options)
    if (expiresAt === null) return failure('EXPIRED', '本地操作请求已过期。', false)
    try {
      const result = await this.inputs.supervisor.registerGrant({
        operation_id: SupervisorOperationId(input.operation_id),
        subject: resolved.value.subject,
        root_path: selection.root_path,
        display_name: selection.display_name,
        access: 'read_only',
        allowed_intents: [resolved.value.request.operation],
        expires_at: expiresAt,
      })
      if (result.receipt.status !== 'succeeded') {
        const receipt = receiptView(result.receipt, input.interaction_ref, [])
        this.commitReceipt(input.operation_id, receipt)
        return failedReceiptResult(result.receipt, input.operation_id)
      }
      const resource = resourceView(result.grant, requirement.resource_kind)
      const consent: LocalConsentView = {
        consent_ref: LocalConsentRef(`consent:${input.operation_id}`),
        interaction_ref: input.interaction_ref,
        slot_ref: input.slot_ref,
        grant_handle: resource.grant_handle,
        state: 'pending',
        interaction_revision: resolved.value.request.revision,
        resource_revision: resource.revision,
        expires_at: resource.expires_at,
      }
      this.grants.set(resource.grant_handle, {
        interaction_ref: input.interaction_ref,
        slot_ref: input.slot_ref,
        subject: resolved.value.subject,
        supervisor_grant: result.grant,
        resource_kind: 'directory',
      })
      const receipt = receiptView(result.receipt, resource.grant_handle, [])
      this.operationReceiptRefs.set(input.operation_id, receipt.receipt_ref)
      this.replace({
        resources: [...this.currentSnapshot().resources, resource],
        consents: [...this.currentSnapshot().consents, consent],
        receipts: [...this.currentSnapshot().receipts, receipt],
      })
      return { ok: true, value: { state: 'selected', resource, consent } }
    } catch (error) {
      return { ok: false, error: productError(error, input.operation_id) }
    }
  }

  private async authorizeLocalOperationOnce(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    this.expireResources()
    const resolved = await this.resolveCurrent(input.interaction_ref)
    if (!resolved.ok) return resolved
    if (resolved.value.request.revision !== input.expected_interaction_revision) {
      return failure('VERSION_MISMATCH', '本地操作请求已更新，请重新确认。', false, resolved.value.request.revision)
    }
    const binding = this.grants.get(input.grant_handle)
    if (binding === undefined || binding.interaction_ref !== input.interaction_ref) {
      return failure('FORBIDDEN', '该本地资源不属于当前操作请求。', false)
    }
    if (!sameSubject(binding.subject, resolved.value.subject)) {
      return failure('FORBIDDEN', '本地资源的执行身份已变化。', false)
    }
    const resource = this.currentSnapshot().resources.find(item => item.grant_handle === input.grant_handle)
    if (resource === undefined || resource.state !== 'active') {
      return failure('EXPIRED', '本地资源授权已失效。', false)
    }
    if (resource.revision !== input.expected_resource_revision) {
      return failure('VERSION_MISMATCH', '本地资源授权已更新，请重新确认。', false, resource.revision)
    }
    const requirement = resolved.value.request.resource_requirements.find(item => item.slot_ref === binding.slot_ref)
    if (requirement === undefined || requirement.resource_kind !== binding.resource_kind || requirement.access !== 'read') {
      return failure('FORBIDDEN', '本地资源槽已变化。', false)
    }
    const consent = this.currentSnapshot().consents.find(item =>
      item.interaction_ref === input.interaction_ref && item.grant_handle === input.grant_handle)
    if (consent === undefined || consent.state !== 'pending'
      || consent.interaction_revision !== input.expected_interaction_revision
      || consent.resource_revision !== input.expected_resource_revision) {
      return failure('CONFLICT', '本地授权已处理或需要重新确认。', false)
    }
    const spec = readSpec(resolved.value.request, this.inputs.options.max_read_bytes)
    if (!spec.ok) return spec
    this.commitConsent(consent, 'authorized')

    try {
      const hello = await this.inputs.supervisor.hello()
      if (!hello.capabilities.includes(resolved.value.request.capability_ref)) {
        return failure('DENIED', '当前设备不支持请求的本地能力。', false)
      }
      const result = await this.inputs.supervisor.readCapability({
        operation_id: SupervisorOperationId(input.operation_id),
        execution_context: {
          kind: 'capability_only',
          capability_context_handle: hello.capability_context_handle,
        },
        subject: resolved.value.subject,
        grant_handle: binding.supervisor_grant.grant_handle,
        expected_grant_revision: binding.supervisor_grant.grant_revision,
        intent: spec.value.intent,
        relative_segments: spec.value.relative_segments,
        max_bytes: Math.min(spec.value.max_bytes, hello.max_result_bytes),
        deadline_at: new Date(this.inputs.options.now().getTime() + this.inputs.options.read_timeout_ms).toISOString(),
      } satisfies ReadCapabilityRequest)
      if (result.receipt.status !== 'succeeded') {
        const receipt = receiptView(result.receipt, input.interaction_ref, [])
        this.commitReceipt(input.operation_id, receipt)
        return failedReceiptResult(result.receipt, input.operation_id)
      }
      let publication
      try {
        publication = await this.inputs.result_sink.publish({
          interaction: resolved.value.request,
          operation_id: input.operation_id,
          result,
        })
      } catch {
        return failure(
          'UNKNOWN_OUTCOME',
          '本地读取已完成，但结果发布状态未知，请使用原操作查询。',
          true,
          undefined,
          input.operation_id,
        )
      }
      const receipt = receiptView(result.receipt, input.interaction_ref, publication.material_refs)
      this.commitReceipt(input.operation_id, receipt)
      return { ok: true, value: receipt }
    } catch (error) {
      return { ok: false, error: productError(error, input.operation_id) }
    }
  }

  private async revokeResourceOnce(
    input: RevokeResourceInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    this.expireResources()
    const binding = this.grants.get(input.grant_handle)
    const resource = this.currentSnapshot().resources.find(item => item.grant_handle === input.grant_handle)
    if (binding === undefined || resource === undefined) return failure('NOT_FOUND', '本地资源授权不存在。', false)
    if (resource.revision !== input.expected_revision) {
      return failure('VERSION_MISMATCH', '本地资源授权已更新。', false, resource.revision)
    }
    if (resource.state !== 'active') return failure('EXPIRED', '本地资源授权已失效。', false)
    try {
      const supervisorReceipt = await this.inputs.supervisor.revokeGrant({
        operation_id: SupervisorOperationId(input.operation_id),
        grant_handle: binding.supervisor_grant.grant_handle,
        expected_grant_revision: binding.supervisor_grant.grant_revision,
      })
      const receipt = receiptView(supervisorReceipt, input.grant_handle, [])
      if (supervisorReceipt.status !== 'succeeded') {
        this.commitReceipt(input.operation_id, receipt)
        return failedReceiptResult(supervisorReceipt, input.operation_id)
      }
      this.operationReceiptRefs.set(input.operation_id, receipt.receipt_ref)
      const current = this.currentSnapshot()
      this.replace({
        resources: current.resources.map(item => item.grant_handle === input.grant_handle
          ? { ...item, state: 'revoked' }
          : item),
        consents: current.consents.map(item => item.grant_handle === input.grant_handle
          ? { ...item, state: 'revoked' }
          : item),
        receipts: [...current.receipts, receipt],
      })
      return { ok: true, value: receipt }
    } catch (error) {
      return { ok: false, error: productError(error, input.operation_id) }
    }
  }

  private async resolveCurrent(
    interactionRef: AuthorizeLocalOperationInput['interaction_ref'],
  ): Promise<ProductResult<AuthoritativeLocalOperation>> {
    const resolved = await this.inputs.interactions.resolve(interactionRef)
    if (resolved === null || resolved.request.interaction_ref !== interactionRef) {
      return failure('NOT_FOUND', '本地操作请求不存在。', false)
    }
    if (isExpired(resolved.request.expires_at, this.inputs.options.now())) {
      return failure('EXPIRED', '本地操作请求已过期。', false)
    }
    return { ok: true, value: resolved }
  }

  private commitConsent(consent: LocalConsentView, state: LocalConsentView['state']): void {
    const current = this.currentSnapshot()
    this.replace({
      resources: current.resources,
      consents: current.consents.map(item => item.consent_ref === consent.consent_ref
        ? { ...item, state }
        : item),
      receipts: current.receipts,
    })
  }

  private commitReceipt(operationId: OperationIdType, receipt: LocalCapabilityReceiptView): void {
    this.operationReceiptRefs.set(operationId, receipt.receipt_ref)
    const current = this.currentSnapshot()
    this.replace({
      resources: current.resources,
      consents: current.consents,
      receipts: [...current.receipts, receipt],
    })
  }

  private expireResources(): void {
    const current = this.currentSnapshot()
    const now = this.inputs.options.now()
    const expiredHandles = new Set(current.resources
      .filter(item => item.state === 'active' && isExpired(item.expires_at, now))
      .map(item => item.grant_handle))
    if (expiredHandles.size === 0) return
    this.replace({
      resources: current.resources.map(item => expiredHandles.has(item.grant_handle)
        ? { ...item, state: 'expired' }
        : item),
      consents: current.consents.map(item => expiredHandles.has(item.grant_handle) && item.state === 'pending'
        ? { ...item, state: 'expired' }
        : item),
      receipts: current.receipts,
    })
  }

  private replace(parts: Pick<LocalCapabilitySnapshot, 'resources' | 'consents' | 'receipts'>): void {
    const current = this.currentSnapshot()
    this.publishReplacement({
      state: 'ready',
      ...parts,
      view_generation: current.view_generation + 1,
      observed_at: this.inputs.options.now().toISOString(),
    })
  }

  private executeIdempotent<T>(
    operationId: OperationIdType,
    fingerprint: string,
    action: string,
    subjectRef: string,
    run: () => Promise<ProductResult<T>>,
    receiptOf?: (value: T) => ReceiptRefType,
  ): Promise<ProductResult<T>> {
    const existing = this.operations.get(operationId)
    if (existing !== undefined) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.resolve(failure('CONFLICT', '操作标识已用于不同请求。', false))
      }
      return existing.promise as Promise<ProductResult<T>>
    }
    const timestamp = this.inputs.options.now().toISOString()
    const entry: OperationRecord = {
      fingerprint,
      promise: Promise.resolve(failure('UNAVAILABLE', '本地能力尚未开始。', true)),
      status: {
        operation_id: operationId,
        action,
        subject_ref: subjectRef,
        state: 'pending',
        revision: OwnerRevision(timestamp),
        updated_at: timestamp,
      },
    }
    const promise = run().then(result => {
      const updatedAt = this.inputs.options.now().toISOString()
      const receiptRef = this.operationReceiptRefs.get(operationId)
        ?? (result.ok && receiptOf !== undefined ? receiptOf(result.value) : undefined)
      const receipt = receiptRef === undefined ? {} : { receipt_ref: receiptRef }
      entry.status = {
        operation_id: operationId,
        action,
        subject_ref: subjectRef,
        state: operationState(result),
        ...receipt,
        revision: OwnerRevision(updatedAt),
        updated_at: updatedAt,
      }
      return result
    }, () => {
      const result = failure<T>('UNAVAILABLE', '本地能力暂时不可用。', true, undefined, operationId)
      const updatedAt = this.inputs.options.now().toISOString()
      entry.status = {
        operation_id: operationId,
        action,
        subject_ref: subjectRef,
        state: 'failed',
        revision: OwnerRevision(updatedAt),
        updated_at: updatedAt,
      }
      return result
    })
    entry.promise = promise as Promise<ProductResult<unknown>>
    this.operations.set(operationId, entry)
    return promise
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`local capability ${name} must be a positive safe integer`)
  }
}

function fingerprintOf(action: string, input: object): string {
  return JSON.stringify([action, input])
}

function sameSubject(left: SupervisorSubjectBinding, right: SupervisorSubjectBinding): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isReadOnlyOperation(request: LocalOperationRequestView): boolean {
  return request.effect_class === 'none'
    && (request.operation === 'directory/list' || request.operation === 'file/read_text')
}

function grantExpiry(
  request: LocalOperationRequestView,
  options: LocalCapabilityCoordinatorOptions,
): string | null {
  const now = options.now().getTime()
  const requested = request.expires_at === undefined ? Number.POSITIVE_INFINITY : Date.parse(request.expires_at)
  const expires = Math.min(now + options.grant_lifetime_ms, requested)
  return Number.isFinite(expires) && expires > now ? new Date(expires).toISOString() : null
}

function readSpec(request: LocalOperationRequestView, configuredMaxBytes: number): ProductResult<ReadSpec> {
  if (!isReadOnlyOperation(request) || !isJsonRecord(request.arguments)) {
    return failure('DENIED', '本地操作不属于允许的只读能力。', false)
  }
  const args = request.arguments
  const segmentsValue = args.relative_segments
  const relativeSegments = segmentsValue === undefined
    ? []
    : Array.isArray(segmentsValue) && segmentsValue.every(value => typeof value === 'string')
      ? segmentsValue
      : null
  if (relativeSegments === null || relativeSegments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    return failure('INVALID_REQUEST', '本地操作的相对目标无效。', false)
  }
  const requestedMax = args.max_bytes
  if (requestedMax !== undefined && (!Number.isSafeInteger(requestedMax) || Number(requestedMax) <= 0)) {
    return failure('INVALID_REQUEST', '本地操作的结果大小限制无效。', false)
  }
  return {
    ok: true,
    value: {
      intent: request.operation,
      relative_segments: relativeSegments,
      max_bytes: Math.min(configuredMaxBytes, requestedMax === undefined ? configuredMaxBytes : Number(requestedMax)),
    },
  }
}

function resourceView(grant: SupervisorGrant, resourceKind: 'directory'): LocalResourceView {
  return {
    grant_handle: LocalResourceHandleRef(grant.grant_handle),
    display_name: grant.display_name,
    resource_kind: resourceKind,
    access: 'read',
    revision: OwnerRevision(grant.grant_revision),
    expires_at: grant.expires_at,
    state: 'active',
  }
}

function receiptView(
  receipt: SupervisorReceipt,
  subjectRef: string,
  materialRefs: LocalCapabilityReceiptView['result_material_refs'],
): LocalCapabilityReceiptView {
  return {
    receipt_ref: ReceiptRef(receipt.receipt_ref),
    subject_ref: subjectRef,
    status: receipt.status,
    effect_state: receipt.effect_state,
    result_material_refs: materialRefs,
    ...(receipt.reason_code === undefined ? {} : { reason_code: receipt.reason_code }),
    revision: OwnerRevision(receipt.receipt_hash),
    recorded_at: receipt.recorded_at,
  }
}

function failedReceiptResult<T>(
  receipt: SupervisorReceipt,
  operationId: OperationIdType,
): ProductResult<T> {
  switch (receipt.status) {
    case 'unknown':
      return failure(
        'UNKNOWN_OUTCOME',
        '本地操作结果未知，请使用原操作查询。',
        true,
        undefined,
        operationId,
      )
    case 'rejected':
      return failure(
        'DENIED',
        '本地操作被安全策略拒绝。',
        false,
        undefined,
        operationId,
      )
    case 'failed':
      return failure(
        'UNAVAILABLE',
        '本地操作执行失败。',
        false,
        undefined,
        operationId,
      )
    case 'succeeded':
      throw new TypeError('succeeded Supervisor Receipt cannot be converted to a failure')
  }
}

function isExpired(expiresAt: string | undefined, now: Date): boolean {
  return expiresAt !== undefined && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime())
}

function operationState(result: ProductResult<unknown>): OperationStatusView['state'] {
  if (result.ok) return 'succeeded'
  if (result.error.code === 'UNKNOWN_OUTCOME') return 'unknown'
  if (result.error.code === 'DENIED' || result.error.code === 'FORBIDDEN') return 'rejected'
  return 'failed'
}

function productError(error: unknown, operationId: OperationIdType): ProductError {
  if (!(error instanceof SupervisorControlError)) {
    return {
      code: 'UNAVAILABLE',
      message: '本地能力暂时不可用。',
      retryable: true,
      operation_id: operationId,
    }
  }
  switch (error.code) {
    case 'OPERATION_CONFLICT':
      return { code: 'CONFLICT', message: '操作标识已用于不同请求。', retryable: false, operation_id: operationId }
    case 'NOT_FOUND':
      return { code: 'NOT_FOUND', message: '本地能力记录不存在。', retryable: false, operation_id: operationId }
    case 'GRANT_REVISION_MISMATCH':
      return { code: 'VERSION_MISMATCH', message: '本地资源授权已更新。', retryable: false, operation_id: operationId }
    case 'GRANT_NOT_ACTIVE':
    case 'DEADLINE_EXPIRED':
      return { code: 'EXPIRED', message: '本地资源授权已失效。', retryable: false, operation_id: operationId }
    case 'OUTCOME_UNKNOWN':
      return { code: 'UNKNOWN_OUTCOME', message: '本地操作结果未知，请使用原操作查询。', retryable: true, operation_id: operationId }
    case 'SUPERVISOR_UNAVAILABLE':
      return { code: 'UNAVAILABLE', message: '本地能力暂时不可用。', retryable: true, operation_id: operationId }
    case 'INVALID_REQUEST':
      return { code: 'INVALID_REQUEST', message: '本地能力请求无效。', retryable: false, operation_id: operationId }
    case 'RUNTIME_VERSION_MISMATCH':
    case 'GRANT_SCOPE_MISMATCH':
    case 'CAPABILITY_DENIED':
    case 'TARGET_IDENTITY_CHANGED':
      return { code: 'DENIED', message: '本地能力请求被安全策略拒绝。', retryable: false, operation_id: operationId }
  }
  return { code: 'UNAVAILABLE', message: '本地能力暂时不可用。', retryable: true, operation_id: operationId }
}

function failure<T>(
  code: ProductError['code'],
  message: string,
  retryable: boolean,
  currentRevision?: OwnerRevisionType,
  operationId?: OperationIdType,
): ProductResult<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(currentRevision === undefined ? {} : { current_revision: currentRevision }),
      ...(operationId === undefined ? {} : { operation_id: operationId }),
    },
  }
}

function isJsonRecord(
  value: LocalOperationRequestView['arguments'],
): value is { readonly [key: string]: import('@deepseek-ai/dsh-aistaff-employee-experience/types').JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export default LocalCapabilityPort
