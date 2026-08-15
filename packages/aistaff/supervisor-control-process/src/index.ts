/** Host SupervisorControl provider over the authenticated Rust sidecar process. @module @deepseek-ai/dsh-aistaff-supervisor-control-process */

import { Buffer } from 'node:buffer'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  SupervisorControlError,
  SupervisorControlPort,
} from '@deepseek-ai/dsh-aistaff-supervisor-control'
import type {
  CapabilityContextHandle,
  ReadCapabilityPayload,
  ReadCapabilityRequest,
  ReadCapabilityResult,
  SupervisorActivityRef,
  SupervisorControlErrorCode,
  SupervisorDeviceSessionId,
  SupervisorDshSessionId,
  SupervisorEvidenceRef,
  SupervisorGrant,
  SupervisorGrantHandle,
  SupervisorGrantRegister,
  SupervisorGrantResult,
  SupervisorGrantRevision,
  SupervisorGrantRevoke,
  SupervisorHello,
  SupervisorOperationId,
  SupervisorOperationStatus,
  SupervisorReceipt,
  SupervisorReceiptRef,
  SupervisorRootFingerprint,
  SupervisorRunId,
  SupervisorStepId,
  SupervisorSubjectBinding,
  SupervisorTenantId,
} from '@deepseek-ai/dsh-aistaff-supervisor-control/types'
import {
  SupervisorProcessError,
  type SupervisorJsonObject,
  type SupervisorProcessCommand,
  type SupervisorProcessService,
} from '@deepseek-ai/dsh-aistaff-supervisor-process'

const CONTROL_VERSION = 'aidesktop.supervisor-control.v1'
const PROCESS_FRAME_BYTE_LIMIT = 64 * 1024
const MAX_IDENTIFIER_BYTES = 180
const MAX_DISPLAY_NAME_BYTES = 255
const MAX_ROOT_PATH_BYTES = 4_096
const CONTROL_CAPABILITIES = ['file/read_text', 'directory/list'] as const
const CONTROL_ERROR_CODES: ReadonlySet<string> = new Set<SupervisorControlErrorCode>([
  'SUPERVISOR_UNAVAILABLE',
  'RUNTIME_VERSION_MISMATCH',
  'GRANT_NOT_ACTIVE',
  'GRANT_REVISION_MISMATCH',
  'GRANT_SCOPE_MISMATCH',
  'CAPABILITY_DENIED',
  'TARGET_IDENTITY_CHANGED',
  'DEADLINE_EXPIRED',
  'OUTCOME_UNKNOWN',
  'INVALID_REQUEST',
  'OPERATION_CONFLICT',
  'NOT_FOUND',
])
const RFC3339_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]*$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

type ControlIntent = typeof CONTROL_CAPABILITIES[number]
type JsonRecord = Record<string, unknown>

/** Cordis plugin name. */
export const name = 'aistaff-supervisor-control-process'

/** The authenticated process service required by this provider. */
export const inject = ['aistaffSupervisorProcess']

function exactObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.hasOwn(value, key)) && keys.every(key => allowed.has(key))
}

function denseArray(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false
  }
  return Object.keys(value).every(key => /^(?:0|[1-9]\d*)$/.test(key) && Number(key) < value.length)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && [...value].every((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && codePoint > 0x1f && codePoint !== 0x7f
  })
}

function identifier(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= MAX_IDENTIFIER_BYTES
    && SAFE_IDENTIFIER.test(value)
}

function safeToken(value: unknown): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= MAX_IDENTIFIER_BYTES
    && SAFE_TOKEN.test(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const match = RFC3339_UTC.exec(value)
  if (match === null) return undefined
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return undefined
  const date = new Date(parsed)
  if (
    date.getUTCFullYear() !== Number(match[1])
    || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])
    || date.getUTCHours() !== Number(match[4])
    || date.getUTCMinutes() !== Number(match[5])
    || date.getUTCSeconds() !== Number(match[6])
  ) return undefined
  return parsed
}

function jsonBytes(value: unknown): number | undefined {
  try {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? undefined : Buffer.byteLength(encoded, 'utf8')
  } catch {
    // Circular or non-JSON input is an invalid control request.
    return undefined
  }
}

function isControlIntent(value: unknown): value is ControlIntent {
  return typeof value === 'string' && (CONTROL_CAPABILITIES as readonly string[]).includes(value)
}

function displayName(value: unknown): value is string {
  return nonEmptyString(value)
    && value.trim().length > 0
    && !value.includes('/')
    && !value.includes('\\')
    && Buffer.byteLength(value, 'utf8') <= MAX_DISPLAY_NAME_BYTES
}

function hasExactStrings(value: unknown, expected: readonly string[]): value is readonly string[] {
  return denseArray(value)
    && value.length === expected.length
    && value.every(item => typeof item === 'string')
    && expected.every((item, index) => value[index] === item)
}

function isRelativeSegment(value: unknown): value is string {
  return nonEmptyString(value) && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\')
}

function operationIdFrom(value: unknown): SupervisorOperationId | undefined {
  if (value === null || typeof value !== 'object' || !('operation_id' in value)) return undefined
  const operationId = (value as { readonly operation_id?: unknown }).operation_id
  return identifier(operationId) ? operationId as SupervisorOperationId : undefined
}

function invalidRequest(operationId?: SupervisorOperationId): never {
  throw new SupervisorControlError('INVALID_REQUEST', operationId === undefined ? {} : { operation_id: operationId })
}

function invalidResult(operationId?: SupervisorOperationId): never {
  throw new SupervisorControlError(
    operationId === undefined ? 'SUPERVISOR_UNAVAILABLE' : 'OUTCOME_UNKNOWN',
    operationId === undefined ? {} : { operation_id: operationId },
  )
}

function validateSubject(value: unknown): SupervisorSubjectBinding | undefined {
  if (exactObject(value, ['kind', 'activity_ref', 'dsh_session_id']) && value.kind === 'local'
    && identifier(value.activity_ref) && identifier(value.dsh_session_id)) {
    return Object.freeze({
      kind: 'local',
      activity_ref: value.activity_ref as SupervisorActivityRef,
      dsh_session_id: value.dsh_session_id as SupervisorDshSessionId,
    })
  }
  if (exactObject(value, [
    'kind',
    'tenant_id',
    'device_session_id',
    'run_id',
    'step_id',
    'attempt',
    'dsh_session_id',
  ]) && value.kind === 'managed'
    && identifier(value.tenant_id)
    && identifier(value.device_session_id)
    && identifier(value.run_id)
    && identifier(value.step_id)
    && positiveInteger(value.attempt)
    && identifier(value.dsh_session_id)) {
    return Object.freeze({
      kind: 'managed',
      tenant_id: value.tenant_id as SupervisorTenantId,
      device_session_id: value.device_session_id as SupervisorDeviceSessionId,
      run_id: value.run_id as SupervisorRunId,
      step_id: value.step_id as SupervisorStepId,
      attempt: value.attempt,
      dsh_session_id: value.dsh_session_id as SupervisorDshSessionId,
    })
  }
  return undefined
}

function validateRegisterRequest(value: unknown, maxRequestBytes: number): SupervisorGrantRegister {
  const operationId = operationIdFrom(value)
  if (!exactObject(value, [
    'operation_id',
    'subject',
    'root_path',
    'display_name',
    'access',
    'allowed_intents',
    'expires_at',
  ]) || operationId === undefined) invalidRequest(operationId)
  const subject = validateSubject(value.subject)
  if (subject === undefined
    || typeof value.root_path !== 'string'
    || !isAbsolute(value.root_path)
    || value.root_path.includes('\0')
    || Buffer.byteLength(value.root_path, 'utf8') > MAX_ROOT_PATH_BYTES
    || !displayName(value.display_name)
    || value.access !== 'read_only'
    || !denseArray(value.allowed_intents)
    || value.allowed_intents.length === 0
    || new Set(value.allowed_intents).size !== value.allowed_intents.length
    || timestamp(value.expires_at) === undefined
    || Date.parse(value.expires_at as string) <= Date.now()) invalidRequest(operationId)
  if (!value.allowed_intents.every(isControlIntent)) {
    throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: operationId })
  }
  const request: SupervisorGrantRegister = Object.freeze({
    operation_id: operationId,
    subject,
    root_path: value.root_path,
    display_name: value.display_name,
    access: 'read_only',
    allowed_intents: Object.freeze([...value.allowed_intents] as ControlIntent[]),
    expires_at: value.expires_at as string,
  })
  const bytes = jsonBytes(request)
  if (bytes === undefined || bytes > maxRequestBytes) invalidRequest(operationId)
  return request
}

function validateRevokeRequest(value: unknown, maxRequestBytes: number): SupervisorGrantRevoke {
  const operationId = operationIdFrom(value)
  if (!exactObject(value, ['operation_id', 'grant_handle', 'expected_grant_revision'])
    || operationId === undefined
    || !identifier(value.grant_handle)
    || !identifier(value.expected_grant_revision)) invalidRequest(operationId)
  const request: SupervisorGrantRevoke = Object.freeze({
    operation_id: operationId,
    grant_handle: value.grant_handle as SupervisorGrantHandle,
    expected_grant_revision: value.expected_grant_revision as SupervisorGrantRevision,
  })
  const bytes = jsonBytes(request)
  if (bytes === undefined || bytes > maxRequestBytes) invalidRequest(operationId)
  return request
}

function validateReadRequest(
  value: unknown,
  hello: SupervisorHello,
): ReadCapabilityRequest {
  const operationId = operationIdFrom(value)
  if (!exactObject(value, [
    'operation_id',
    'execution_context',
    'subject',
    'grant_handle',
    'expected_grant_revision',
    'intent',
    'relative_segments',
    'max_bytes',
    'deadline_at',
  ]) || operationId === undefined) invalidRequest(operationId)
  if (exactObject(value.execution_context, ['kind', 'runtime_handle'])
    && value.execution_context.kind === 'managed_runtime'
    && identifier(value.execution_context.runtime_handle)) {
    throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: operationId })
  }
  if (!exactObject(value.execution_context, ['kind', 'capability_context_handle'])
    || value.execution_context.kind !== 'capability_only'
    || !identifier(value.execution_context.capability_context_handle)) invalidRequest(operationId)
  const subject = validateSubject(value.subject)
  const deadline = timestamp(value.deadline_at)
  if (subject === undefined
    || !identifier(value.grant_handle)
    || !identifier(value.expected_grant_revision)
    || typeof value.intent !== 'string'
    || !denseArray(value.relative_segments)
    || !value.relative_segments.every(isRelativeSegment)
    || !positiveInteger(value.max_bytes)
    || value.max_bytes > hello.max_result_bytes
    || deadline === undefined) invalidRequest(operationId)
  if (!isControlIntent(value.intent)) {
    throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: operationId })
  }
  if (deadline <= Date.now()) throw new SupervisorControlError('DEADLINE_EXPIRED', { operation_id: operationId })
  const request: ReadCapabilityRequest = Object.freeze({
    operation_id: operationId,
    execution_context: Object.freeze({
      kind: 'capability_only',
      capability_context_handle: value.execution_context.capability_context_handle as CapabilityContextHandle,
    }),
    subject,
    grant_handle: value.grant_handle as SupervisorGrantHandle,
    expected_grant_revision: value.expected_grant_revision as SupervisorGrantRevision,
    intent: value.intent,
    relative_segments: Object.freeze([...value.relative_segments] as string[]),
    max_bytes: value.max_bytes,
    deadline_at: value.deadline_at as string,
  })
  const bytes = jsonBytes(request)
  if (bytes === undefined || bytes > hello.max_request_bytes) invalidRequest(operationId)
  return request
}

function validateReceiptRequest(value: unknown, maxRequestBytes: number): { readonly receipt_ref: SupervisorReceiptRef } {
  if (!exactObject(value, ['receipt_ref']) || !identifier(value.receipt_ref)) invalidRequest()
  const request = Object.freeze({ receipt_ref: value.receipt_ref as SupervisorReceiptRef })
  const bytes = jsonBytes(request)
  if (bytes === undefined || bytes > maxRequestBytes) invalidRequest()
  return request
}

function validateOperationRequest(
  value: unknown,
  maxRequestBytes: number,
): { readonly operation_id: SupervisorOperationId } {
  const operationId = operationIdFrom(value)
  if (!exactObject(value, ['operation_id']) || operationId === undefined) invalidRequest(operationId)
  const request = Object.freeze({ operation_id: operationId })
  const bytes = jsonBytes(request)
  if (bytes === undefined || bytes > maxRequestBytes) invalidRequest(operationId)
  return request
}

function validateHello(value: unknown): SupervisorHello {
  if (!exactObject(value, [
    'control_version',
    'supervisor_version',
    'supported_control_versions',
    'platform',
    'architecture',
    'capabilities',
    'max_request_bytes',
    'max_result_bytes',
    'capability_context_handle',
  ])
    || value.control_version !== CONTROL_VERSION
    || !safeToken(value.supervisor_version)
    || !denseArray(value.supported_control_versions)
    || value.supported_control_versions.length !== 1
    || value.supported_control_versions[0] !== CONTROL_VERSION
    || !safeToken(value.platform)
    || !safeToken(value.architecture)
    || !hasExactStrings(value.capabilities, CONTROL_CAPABILITIES)
    || !positiveInteger(value.max_request_bytes)
    || value.max_request_bytes > PROCESS_FRAME_BYTE_LIMIT
    || !positiveInteger(value.max_result_bytes)
    || value.max_result_bytes > value.max_request_bytes
    || !identifier(value.capability_context_handle)) {
    throw new SupervisorControlError('RUNTIME_VERSION_MISMATCH')
  }
  return Object.freeze({
    control_version: CONTROL_VERSION,
    supervisor_version: value.supervisor_version,
    supported_control_versions: Object.freeze([CONTROL_VERSION]),
    platform: value.platform,
    architecture: value.architecture,
    capabilities: Object.freeze([...CONTROL_CAPABILITIES]),
    max_request_bytes: value.max_request_bytes,
    max_result_bytes: value.max_result_bytes,
    capability_context_handle: value.capability_context_handle as CapabilityContextHandle,
  })
}

function validateReceipt(
  value: unknown,
  operationId?: SupervisorOperationId,
  receiptRef?: SupervisorReceiptRef,
): SupervisorReceipt {
  if (!exactObject(value, [
    'receipt_ref',
    'operation_id',
    'status',
    'effect_state',
    'evidence_refs',
    'receipt_hash',
    'recorded_at',
  ], ['reason_code'])
    || !identifier(value.receipt_ref)
    || !identifier(value.operation_id)
    || operationId !== undefined && value.operation_id !== operationId
    || receiptRef !== undefined && value.receipt_ref !== receiptRef
    || !['succeeded', 'failed', 'rejected', 'unknown'].includes(value.status as string)
    || !['none', 'not_applied', 'applied', 'unknown'].includes(value.effect_state as string)
    || value.reason_code !== undefined && (typeof value.reason_code !== 'string' || !SAFE_REASON_CODE.test(value.reason_code))
    || !denseArray(value.evidence_refs)
    || !value.evidence_refs.every(identifier)
    || new Set(value.evidence_refs).size !== value.evidence_refs.length
    || !identifier(value.receipt_hash)
    || timestamp(value.recorded_at) === undefined) invalidResult(operationId)
  return Object.freeze({
    receipt_ref: value.receipt_ref as SupervisorReceiptRef,
    operation_id: value.operation_id as SupervisorOperationId,
    status: value.status as SupervisorReceipt['status'],
    effect_state: value.effect_state as SupervisorReceipt['effect_state'],
    ...(value.reason_code === undefined ? {} : { reason_code: value.reason_code as string }),
    evidence_refs: Object.freeze([...value.evidence_refs] as SupervisorEvidenceRef[]),
    receipt_hash: value.receipt_hash,
    recorded_at: value.recorded_at as string,
  })
}

function validateGrant(value: unknown, operationId: SupervisorOperationId): SupervisorGrant {
  if (!exactObject(value, [
    'grant_handle',
    'grant_revision',
    'display_name',
    'access',
    'allowed_intents',
    'expires_at',
    'root_fingerprint',
  ])
    || !identifier(value.grant_handle)
    || !identifier(value.grant_revision)
    || !displayName(value.display_name)
    || value.access !== 'read_only'
    || !denseArray(value.allowed_intents)
    || value.allowed_intents.length === 0
    || !value.allowed_intents.every(isControlIntent)
    || new Set(value.allowed_intents).size !== value.allowed_intents.length
    || timestamp(value.expires_at) === undefined
    || !identifier(value.root_fingerprint)) invalidResult(operationId)
  return Object.freeze({
    grant_handle: value.grant_handle as SupervisorGrantHandle,
    grant_revision: value.grant_revision as SupervisorGrantRevision,
    display_name: value.display_name,
    access: 'read_only',
    allowed_intents: Object.freeze([...value.allowed_intents] as ControlIntent[]),
    expires_at: value.expires_at as string,
    root_fingerprint: value.root_fingerprint as SupervisorRootFingerprint,
  })
}

function validateGrantResult(value: unknown, request: SupervisorGrantRegister): SupervisorGrantResult {
  if (!exactObject(value, ['grant', 'receipt'])) invalidResult(request.operation_id)
  const grant = validateGrant(value.grant, request.operation_id)
  if (grant.display_name !== request.display_name
    || grant.access !== request.access
    || grant.expires_at !== request.expires_at
    || grant.allowed_intents.length !== request.allowed_intents.length
    || !grant.allowed_intents.every((intent, index) => intent === request.allowed_intents[index])) {
    invalidResult(request.operation_id)
  }
  return Object.freeze({
    grant,
    receipt: validateReceipt(value.receipt, request.operation_id),
  })
}

function decodeBase64(value: unknown, operationId: SupervisorOperationId): Uint8Array {
  if (typeof value !== 'string' || !BASE64.test(value)) invalidResult(operationId)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) invalidResult(operationId)
  return Uint8Array.from(decoded)
}

function validateDirectoryEntry(value: unknown, operationId: SupervisorOperationId): Readonly<{
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size_bytes?: number
}> {
  if (!exactObject(value, ['name', 'kind'], ['size_bytes'])
    || !isRelativeSegment(value.name)
    || value.kind !== 'file' && value.kind !== 'directory'
    || value.size_bytes !== undefined && !nonNegativeInteger(value.size_bytes)) invalidResult(operationId)
  return Object.freeze({
    name: value.name,
    kind: value.kind,
    ...(value.size_bytes === undefined ? {} : { size_bytes: value.size_bytes }),
  })
}

function validatePayload(
  value: unknown,
  request: ReadCapabilityRequest,
  maxResultBytes: number,
): ReadCapabilityPayload {
  if (exactObject(value, ['kind', 'bytes_base64', 'media_type']) && value.kind === 'file') {
    if (request.intent !== 'file/read_text' || value.media_type !== 'text/plain; charset=utf-8') {
      invalidResult(request.operation_id)
    }
    const bytes = decodeBase64(value.bytes_base64, request.operation_id)
    if (bytes.byteLength > request.max_bytes || bytes.byteLength > maxResultBytes) invalidResult(request.operation_id)
    return { kind: 'file', bytes, media_type: value.media_type }
  }
  if (exactObject(value, ['kind', 'entries']) && value.kind === 'directory' && denseArray(value.entries)) {
    if (request.intent !== 'directory/list') invalidResult(request.operation_id)
    const payload: ReadCapabilityPayload = Object.freeze({
      kind: 'directory',
      entries: Object.freeze(value.entries.map(entry => validateDirectoryEntry(entry, request.operation_id))),
    })
    const bytes = jsonBytes(payload)
    if (bytes === undefined || bytes > request.max_bytes || bytes > maxResultBytes) invalidResult(request.operation_id)
    return payload
  }
  return invalidResult(request.operation_id)
}

function validateReadResult(
  value: unknown,
  request: ReadCapabilityRequest,
  maxResultBytes: number,
): ReadCapabilityResult {
  if (!exactObject(value, ['payload', 'receipt'])) invalidResult(request.operation_id)
  return Object.freeze({
    payload: validatePayload(value.payload, request, maxResultBytes),
    receipt: validateReceipt(value.receipt, request.operation_id),
  })
}

function validateOperationStatus(value: unknown, operationId: SupervisorOperationId): SupervisorOperationStatus {
  if (!exactObject(value, ['operation_id', 'state', 'updated_at'], ['receipt_ref'])
    || value.operation_id !== operationId
    || !['succeeded', 'failed', 'rejected', 'unknown'].includes(value.state as string)
    || value.receipt_ref !== undefined && !identifier(value.receipt_ref)
    || timestamp(value.updated_at) === undefined) invalidResult(operationId)
  return Object.freeze({
    operation_id: value.operation_id as SupervisorOperationId,
    state: value.state as SupervisorOperationStatus['state'],
    ...(value.receipt_ref === undefined ? {} : { receipt_ref: value.receipt_ref as SupervisorReceiptRef }),
    updated_at: value.updated_at as string,
  })
}

function jsonObject(value: object): SupervisorJsonObject {
  return value as unknown as SupervisorJsonObject
}

function remoteControlCode(error: SupervisorProcessError): SupervisorControlErrorCode | undefined {
  return error.code === 'REMOTE_ERROR' && error.remote_code !== undefined && CONTROL_ERROR_CODES.has(error.remote_code)
    ? error.remote_code as SupervisorControlErrorCode
    : undefined
}

async function invoke(
  processService: SupervisorProcessService,
  command: SupervisorProcessCommand,
  payload: SupervisorJsonObject | undefined,
  operationId?: SupervisorOperationId,
  startup = false,
): Promise<SupervisorJsonObject> {
  try {
    return await processService.invoke(command, payload)
  } catch (error) {
    if (error instanceof SupervisorProcessError) {
      const controlCode = remoteControlCode(error)
      if (controlCode !== undefined) {
        throw new SupervisorControlError(controlCode, operationId === undefined ? {} : { operation_id: operationId })
      }
      if (error.code === 'REQUEST_TIMEOUT' && operationId !== undefined) {
        throw new SupervisorControlError('OUTCOME_UNKNOWN', { operation_id: operationId })
      }
      if (error.code === 'REQUEST_TOO_LARGE') {
        throw new SupervisorControlError('INVALID_REQUEST', operationId === undefined ? {} : { operation_id: operationId })
      }
      if (startup && (error.code === 'COMMAND_DENIED' || error.code === 'PROTOCOL_ERROR')) {
        throw new SupervisorControlError('RUNTIME_VERSION_MISMATCH')
      }
      if (operationId !== undefined
        && error.code !== 'COMMAND_DENIED'
        && error.code !== 'REMOTE_ERROR') {
        throw new SupervisorControlError('OUTCOME_UNKNOWN', { operation_id: operationId })
      }
    }
    throw new SupervisorControlError('SUPERVISOR_UNAVAILABLE', operationId === undefined ? {} : { operation_id: operationId })
  }
}

/** `SupervisorControlPort` implementation backed only by authoritative Rust control commands. */
export class SupervisorControlProcessPort extends SupervisorControlPort {
  private constructor(
    ctx: Context,
    private readonly processService: SupervisorProcessService,
    private readonly greeting: SupervisorHello,
  ) {
    super(ctx)
  }

  /**
   * Complete and validate the Rust control handshake before publishing the service.
   * @param ctx - Host Cordis context receiving the control service.
   * @param processService - authenticated Rust process carrier.
   * @returns the published process-backed control provider.
   */
  static async create(ctx: Context, processService: SupervisorProcessService): Promise<SupervisorControlProcessPort> {
    const greeting = validateHello(await invoke(processService, 'control.hello', undefined, undefined, true))
    return new SupervisorControlProcessPort(ctx, processService, greeting)
  }

  /** @inheritdoc */
  override hello(): Promise<SupervisorHello> {
    return Promise.resolve(this.greeting)
  }

  /** @inheritdoc */
  override async registerGrant(input: SupervisorGrantRegister): Promise<SupervisorGrantResult> {
    const request = validateRegisterRequest(input, this.greeting.max_request_bytes)
    const result = await invoke(
      this.processService,
      'control.grant.register',
      jsonObject(request),
      request.operation_id,
    )
    return validateGrantResult(result, request)
  }

  /** @inheritdoc */
  override async revokeGrant(input: SupervisorGrantRevoke): Promise<SupervisorReceipt> {
    const request = validateRevokeRequest(input, this.greeting.max_request_bytes)
    const result = await invoke(
      this.processService,
      'control.grant.revoke',
      jsonObject(request),
      request.operation_id,
    )
    return validateReceipt(result, request.operation_id)
  }

  /** @inheritdoc */
  override async readCapability(input: ReadCapabilityRequest): Promise<ReadCapabilityResult> {
    const request = validateReadRequest(input, this.greeting)
    const result = await invoke(
      this.processService,
      'control.capability.read',
      jsonObject(request),
      request.operation_id,
    )
    return validateReadResult(result, request, this.greeting.max_result_bytes)
  }

  /** @inheritdoc */
  override async getReceipt(input: { readonly receipt_ref: SupervisorReceiptRef }): Promise<SupervisorReceipt> {
    const request = validateReceiptRequest(input, this.greeting.max_request_bytes)
    return validateReceipt(
      await invoke(this.processService, 'control.receipt.get', jsonObject(request)),
      undefined,
      request.receipt_ref,
    )
  }

  /** @inheritdoc */
  override async readOperation(input: { readonly operation_id: SupervisorOperationId }): Promise<SupervisorOperationStatus> {
    const request = validateOperationRequest(input, this.greeting.max_request_bytes)
    const result = await invoke(
      this.processService,
      'control.operation.read',
      jsonObject(request),
      request.operation_id,
    )
    return validateOperationStatus(result, request.operation_id)
  }
}

/**
 * Validate `control.hello` and publish the Rust-backed Host control provider.
 * @param ctx - Host context carrying the authenticated process service.
 */
export async function apply(ctx: Context): Promise<void> {
  await SupervisorControlProcessPort.create(ctx, ctx.aistaffSupervisorProcess)
}
