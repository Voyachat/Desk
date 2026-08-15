/** Strict in-memory Supervisor provider used only by this package's tests. */

import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CapabilityContextHandle,
  SupervisorControlError,
  SupervisorControlPort,
  SupervisorGrantHandle,
  SupervisorGrantRevision,
  SupervisorReceiptRef,
  SupervisorRootFingerprint,
} from './index.ts'
import type {
  ReadCapabilityPayload,
  ReadCapabilityRequest,
  ReadCapabilityResult,
  SupervisorControlErrorCode,
  SupervisorGrant,
  SupervisorGrantRegister,
  SupervisorGrantResult,
  SupervisorGrantRevoke,
  SupervisorHello,
  SupervisorOperationStatus,
  SupervisorOperationId,
  SupervisorReceipt,
  SupervisorReceiptRef as SupervisorReceiptRefType,
  SupervisorRuntimeHandle,
  SupervisorSubjectBinding,
  SupervisorGrantHandle as SupervisorGrantHandleType,
} from './types.ts'

/** Unknown-result marker accepted by the test provider's intent table. */
export interface InMemoryUnknownOutcome {
  /** Select the reconciliation-only outcome. */
  readonly kind: 'unknown'
}

/** Deterministic knobs for package-local Supervisor control tests. */
export interface InMemorySupervisorControlOptions {
  /** Clock used for expiry, deadlines, and Receipt times. */
  readonly clock?: () => Date
  /** ID source used for context, Grant, revision, Receipt, and fingerprint values. */
  readonly nextId?: (kind: string) => string
  /** Maximum complete request bytes. */
  readonly maxRequestBytes?: number
  /** Maximum complete result bytes. */
  readonly maxResultBytes?: number
  /** Semantic intent results; absent intents are denied. */
  readonly intentResults: Readonly<Record<string, ReadCapabilityPayload | InMemoryUnknownOutcome>>
  /** Managed runtime handles admitted by this provider. */
  readonly managedRuntimeHandles?: readonly SupervisorRuntimeHandle[]
}

interface StoredGrant {
  readonly projection: SupervisorGrant
  readonly subjectKey: string
  readonly rootPath: string
  active: boolean
}

type OperationSettlement =
  | { readonly kind: 'return'; readonly value: unknown }
  | {
      readonly kind: 'throw'
      readonly code: SupervisorControlErrorCode
      readonly receiptRef?: SupervisorReceiptRefType
    }

interface OperationRecord {
  readonly fingerprint: string
  readonly status: SupervisorOperationStatus
  readonly settlement: OperationSettlement
}

const encoder = new TextEncoder()

function bytesOf(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isPlainSegment(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..'
    && !value.includes('/') && !value.includes('\\') && !value.includes('\0')
}

function subjectKey(subject: SupervisorSubjectBinding): string {
  return JSON.stringify(subject)
}

function clonePayload(payload: ReadCapabilityPayload): ReadCapabilityPayload {
  switch (payload.kind) {
    case 'file': return { kind: 'file', bytes: payload.bytes.slice(), media_type: payload.media_type }
    case 'directory': return {
      kind: 'directory',
      entries: payload.entries.map(entry => Object.freeze({ ...entry })),
    }
    case 'metadata': return { ...payload }
  }
}

/** In-memory provider that exercises the control contract without filesystem or sidecar I/O. */
export class InMemorySupervisorControl extends SupervisorControlPort {
  private readonly clock: () => Date
  private readonly nextId: (kind: string) => string
  private readonly grants = new Map<SupervisorGrantHandleType, StoredGrant>()
  private readonly receipts = new Map<SupervisorReceiptRefType, SupervisorReceipt>()
  private readonly operations = new Map<SupervisorOperationId, OperationRecord>()
  private readonly managedRuntimeHandles: ReadonlySet<SupervisorRuntimeHandle>
  private readonly greeting: SupervisorHello

  /**
   * Register a deterministic test provider.
   * @param ctx - isolated package-test context.
   * @param options - fixed bounds, results, identities, and clock.
   */
  constructor(ctx: Context, private readonly options: InMemorySupervisorControlOptions) {
    super(ctx)
    this.clock = options.clock ?? (() => new Date())
    this.nextId = options.nextId ?? (kind => `${kind}-${randomUUID()}`)
    const maxRequestBytes = options.maxRequestBytes ?? 64 * 1024
    const maxResultBytes = options.maxResultBytes ?? 64 * 1024
    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0
      || !Number.isSafeInteger(maxResultBytes) || maxResultBytes <= 0) {
      throw new SupervisorControlError('INVALID_REQUEST')
    }
    this.managedRuntimeHandles = new Set(options.managedRuntimeHandles ?? [])
    this.greeting = Object.freeze({
      control_version: 'aidesktop.supervisor-control.v1',
      supervisor_version: '0.0.0-test-only',
      supported_control_versions: Object.freeze(['aidesktop.supervisor-control.v1']),
      platform: process.platform,
      architecture: process.arch,
      capabilities: Object.freeze(Object.keys(options.intentResults).sort()),
      max_request_bytes: maxRequestBytes,
      max_result_bytes: maxResultBytes,
      capability_context_handle: CapabilityContextHandle(this.nextId('capability-context')),
    })
  }

  /** @inheritdoc */
  override async hello(): Promise<SupervisorHello> {
    return this.greeting
  }

  /** @inheritdoc */
  override async registerGrant(input: SupervisorGrantRegister): Promise<SupervisorGrantResult> {
    return await this.idempotent(input.operation_id, this.fingerprint('registerGrant', input), () => {
      this.checkRequest(input)
      const expires = timestamp(input.expires_at)
      if (!isAbsolute(input.root_path) || input.display_name.trim().length === 0
        || input.allowed_intents.length === 0 || new Set(input.allowed_intents).size !== input.allowed_intents.length
        || input.allowed_intents.some(intent => intent.trim().length === 0)
        || expires === undefined || expires <= this.clock().getTime()) {
        throw new SupervisorControlError('INVALID_REQUEST', { operation_id: input.operation_id })
      }
      this.checkSubject(input.subject, input.operation_id)
      const grantHandle = SupervisorGrantHandle(this.nextId('grant'))
      const projection: SupervisorGrant = Object.freeze({
        grant_handle: grantHandle,
        grant_revision: SupervisorGrantRevision(this.nextId('grant-revision')),
        display_name: input.display_name,
        access: 'read_only',
        allowed_intents: Object.freeze([...input.allowed_intents]),
        expires_at: input.expires_at,
        root_fingerprint: SupervisorRootFingerprint(this.nextId('root-fingerprint')),
      })
      const receipt = this.receipt(input.operation_id, 'succeeded', 'none')
      const value: SupervisorGrantResult = Object.freeze({ grant: projection, receipt })
      this.grants.set(grantHandle, {
        projection,
        subjectKey: subjectKey(input.subject),
        rootPath: input.root_path,
        active: true,
      })
      return { value, receipt }
    })
  }

  /** @inheritdoc */
  override async revokeGrant(input: SupervisorGrantRevoke): Promise<SupervisorReceipt> {
    return await this.idempotent(input.operation_id, this.fingerprint('revokeGrant', input), () => {
      this.checkRequest(input)
      const grant = this.grants.get(input.grant_handle)
      if (grant === undefined) throw new SupervisorControlError('GRANT_NOT_ACTIVE', { operation_id: input.operation_id })
      if (!grant.active) throw new SupervisorControlError('GRANT_NOT_ACTIVE', { operation_id: input.operation_id })
      if (grant.projection.grant_revision !== input.expected_grant_revision) {
        throw new SupervisorControlError('GRANT_REVISION_MISMATCH', { operation_id: input.operation_id })
      }
      grant.active = false
      const receipt = this.receipt(input.operation_id, 'succeeded', 'not_applied')
      return { value: receipt, receipt }
    })
  }

  /** @inheritdoc */
  override async readCapability(input: ReadCapabilityRequest): Promise<ReadCapabilityResult> {
    return await this.idempotent(input.operation_id, this.fingerprint('readCapability', input), () => {
      this.checkRequest(input)
      this.checkReadRequest(input)
      const selected = this.options.intentResults[input.intent]
      if (selected === undefined) {
        throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
      }
      if (selected.kind === 'unknown') {
        const receipt = this.receipt(input.operation_id, 'unknown', 'unknown', 'OUTCOME_UNKNOWN')
        return {
          receipt,
          failure: { code: 'OUTCOME_UNKNOWN', receiptRef: receipt.receipt_ref },
        }
      }
      const payload = clonePayload(selected)
      this.validatePayload(payload, input)
      const receipt = this.receipt(input.operation_id, 'succeeded', 'none')
      const value: ReadCapabilityResult = Object.freeze({ payload, receipt })
      return { value, receipt }
    })
  }

  /** @inheritdoc */
  override async getReceipt(input: { readonly receipt_ref: SupervisorReceiptRefType }): Promise<SupervisorReceipt> {
    const receipt = this.receipts.get(input.receipt_ref)
    if (receipt === undefined) throw new SupervisorControlError('NOT_FOUND')
    return receipt
  }

  /** @inheritdoc */
  override async readOperation(input: { readonly operation_id: SupervisorOperationId }): Promise<SupervisorOperationStatus> {
    const status = this.operations.get(input.operation_id)?.status
    if (status === undefined) throw new SupervisorControlError('NOT_FOUND', { operation_id: input.operation_id })
    return status
  }

  private checkRequest(value: unknown): void {
    if (bytesOf(value) > this.greeting.max_request_bytes) throw new SupervisorControlError('INVALID_REQUEST')
  }

  private checkSubject(subject: SupervisorSubjectBinding, operationId: SupervisorOperationId): void {
    const valid = subject.kind === 'local'
      ? subject.activity_ref.length > 0 && subject.dsh_session_id.length > 0
      : subject.tenant_id.length > 0 && subject.device_session_id.length > 0
        && subject.run_id.length > 0 && subject.step_id.length > 0
        && Number.isSafeInteger(subject.attempt) && subject.attempt > 0
        && subject.dsh_session_id.length > 0
    if (!valid) throw new SupervisorControlError('INVALID_REQUEST', { operation_id: operationId })
  }

  private checkReadRequest(input: ReadCapabilityRequest): void {
    const deadline = timestamp(input.deadline_at)
    if (deadline === undefined || deadline <= this.clock().getTime()) {
      throw new SupervisorControlError('DEADLINE_EXPIRED', { operation_id: input.operation_id })
    }
    if (!Number.isSafeInteger(input.max_bytes) || input.max_bytes <= 0
      || input.max_bytes > this.greeting.max_result_bytes
      || input.intent.trim().length === 0 || input.relative_segments.some(segment => !isPlainSegment(segment))) {
      throw new SupervisorControlError('INVALID_REQUEST', { operation_id: input.operation_id })
    }
    if (input.execution_context.kind === 'capability_only') {
      if (input.execution_context.capability_context_handle !== this.greeting.capability_context_handle) {
        throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
      }
    } else if (!this.managedRuntimeHandles.has(input.execution_context.runtime_handle)) {
      throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
    }
    this.checkSubject(input.subject, input.operation_id)
    const grant = this.grants.get(input.grant_handle)
    if (grant === undefined || !grant.active || Date.parse(grant.projection.expires_at) <= this.clock().getTime()) {
      throw new SupervisorControlError('GRANT_NOT_ACTIVE', { operation_id: input.operation_id })
    }
    if (grant.projection.grant_revision !== input.expected_grant_revision) {
      throw new SupervisorControlError('GRANT_REVISION_MISMATCH', { operation_id: input.operation_id })
    }
    if (grant.subjectKey !== subjectKey(input.subject)) {
      throw new SupervisorControlError('GRANT_SCOPE_MISMATCH', { operation_id: input.operation_id })
    }
    if (!grant.projection.allowed_intents.includes(input.intent)) {
      throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
    }
    // The test provider deliberately retains the privileged root only to prove it never enters a result.
    void grant.rootPath
  }

  private validatePayload(payload: ReadCapabilityPayload, input: ReadCapabilityRequest): void {
    if (payload.kind === 'file') {
      if (payload.media_type.trim().length === 0 || payload.bytes.byteLength > input.max_bytes
        || payload.bytes.byteLength > this.greeting.max_result_bytes) {
        throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
      }
      return
    }
    if (payload.kind === 'directory' && payload.entries.some(entry =>
      !isPlainSegment(entry.name) || (entry.size_bytes !== undefined
        && (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0)))) {
      throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
    }
    if (payload.kind === 'metadata' && payload.size_bytes !== undefined
      && (!Number.isSafeInteger(payload.size_bytes) || payload.size_bytes < 0)) {
      throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
    }
    if (bytesOf(payload) > input.max_bytes || bytesOf(payload) > this.greeting.max_result_bytes) {
      throw new SupervisorControlError('CAPABILITY_DENIED', { operation_id: input.operation_id })
    }
  }

  private receipt(
    operationId: SupervisorOperationId,
    status: SupervisorReceipt['status'],
    effectState: SupervisorReceipt['effect_state'],
    reasonCode?: string,
  ): SupervisorReceipt {
    const base = {
      receipt_ref: SupervisorReceiptRef(this.nextId('receipt')),
      operation_id: operationId,
      status,
      effect_state: effectState,
      ...(reasonCode === undefined ? {} : { reason_code: reasonCode }),
      evidence_refs: Object.freeze([]),
      recorded_at: this.clock().toISOString(),
    }
    const receipt: SupervisorReceipt = Object.freeze({
      ...base,
      receipt_hash: createHash('sha256').update(JSON.stringify(base)).digest('base64url'),
    })
    this.receipts.set(receipt.receipt_ref, receipt)
    return receipt
  }

  private fingerprint(method: string, input: unknown): string {
    return createHash('sha256').update(method).update('\0').update(JSON.stringify(input)).digest('base64url')
  }

  private idempotent<T>(
    operationId: SupervisorOperationId,
    fingerprint: string,
    execute: () => {
      readonly value?: T
      readonly receipt?: SupervisorReceipt
      readonly failure?: { readonly code: SupervisorControlErrorCode; readonly receiptRef?: SupervisorReceiptRefType }
    },
  ): Promise<T> {
    const prior = this.operations.get(operationId)
    if (prior !== undefined) {
      if (prior.fingerprint !== fingerprint) {
        throw new SupervisorControlError('OPERATION_CONFLICT', { operation_id: operationId })
      }
      if (prior.settlement.kind === 'throw') {
        throw new SupervisorControlError(prior.settlement.code, {
          operation_id: operationId,
          ...(prior.settlement.receiptRef === undefined ? {} : { receipt_ref: prior.settlement.receiptRef }),
        })
      }
      return Promise.resolve(prior.settlement.value as T)
    }

    const settled = execute()
    const now = this.clock().toISOString()
    if (settled.failure !== undefined) {
      this.operations.set(operationId, {
        fingerprint,
        settlement: {
          kind: 'throw', code: settled.failure.code,
          ...(settled.failure.receiptRef === undefined ? {} : { receiptRef: settled.failure.receiptRef }),
        },
        status: Object.freeze({
          operation_id: operationId,
          state: 'unknown',
          ...(settled.failure.receiptRef === undefined ? {} : { receipt_ref: settled.failure.receiptRef }),
          updated_at: now,
        }),
      })
      throw new SupervisorControlError(settled.failure.code, {
        operation_id: operationId,
        ...(settled.failure.receiptRef === undefined ? {} : { receipt_ref: settled.failure.receiptRef }),
      })
    }
    const receiptRef = settled.receipt?.receipt_ref
    this.operations.set(operationId, {
      fingerprint,
      settlement: { kind: 'return', value: settled.value },
      status: Object.freeze({
        operation_id: operationId,
        state: settled.receipt?.status ?? 'succeeded',
        ...(receiptRef === undefined ? {} : { receipt_ref: receiptRef }),
        updated_at: now,
      }),
    })
    return Promise.resolve(settled.value as T)
  }
}
