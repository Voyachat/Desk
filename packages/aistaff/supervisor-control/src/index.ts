/** Host-only AiDesktop Supervisor control Service Definition. @module @deepseek-ai/dsh-aistaff-supervisor-control */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CapabilityContextHandle as CapabilityContextHandleType,
  ReadCapabilityRequest,
  ReadCapabilityResult,
  SupervisorActivityRef as SupervisorActivityRefType,
  SupervisorControlErrorCode,
  SupervisorDeviceSessionId as SupervisorDeviceSessionIdType,
  SupervisorDshSessionId as SupervisorDshSessionIdType,
  SupervisorGrantHandle as SupervisorGrantHandleType,
  SupervisorGrantRevision as SupervisorGrantRevisionType,
  SupervisorGrantRegister,
  SupervisorGrantResult,
  SupervisorGrantRevoke,
  SupervisorOperationId as SupervisorOperationIdType,
  SupervisorOperationStatus,
  SupervisorReceipt,
  SupervisorReceiptRef as SupervisorReceiptRefType,
  SupervisorRootFingerprint as SupervisorRootFingerprintType,
  SupervisorEvidenceRef as SupervisorEvidenceRefType,
  SupervisorRunId as SupervisorRunIdType,
  SupervisorRuntimeHandle as SupervisorRuntimeHandleType,
  SupervisorStepId as SupervisorStepIdType,
  SupervisorTenantId as SupervisorTenantIdType,
  SupervisorHello,
} from './types.ts'

export type * from './types.ts'

/** Cordis service key for the Host-only Supervisor control port. */
export const SUPERVISOR_CONTROL_SERVICE_KEY = 'aistaffSupervisorControl' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-only local capability, Grant, and Receipt control port. */
    aistaffSupervisorControl: SupervisorControlPort
  }
}

/** Fail-closed path-free error returned by a Supervisor control provider. */
export class SupervisorControlError extends Error {
  /** Stable machine-routable failure code. */
  readonly code: SupervisorControlErrorCode
  /** Original operation when reconciliation is possible. */
  readonly operation_id?: SupervisorOperationIdType
  /** Retained Receipt when the outcome is uncertain. */
  readonly receipt_ref?: SupervisorReceiptRefType

  /**
   * Create a path-free control failure with fixed safe text.
   * @param code - stable failure code.
   * @param options - optional opaque reconciliation identities.
   */
  constructor(
    code: SupervisorControlErrorCode,
    options: { readonly operation_id?: SupervisorOperationIdType; readonly receipt_ref?: SupervisorReceiptRefType } = {},
  ) {
    super(ERROR_MESSAGES[code])
    this.name = 'SupervisorControlError'
    this.code = code
    if (options.operation_id !== undefined) this.operation_id = options.operation_id
    if (options.receipt_ref !== undefined) this.receipt_ref = options.receipt_ref
  }
}

const ERROR_MESSAGES: Readonly<Record<SupervisorControlErrorCode, string>> = {
  SUPERVISOR_UNAVAILABLE: 'Supervisor is unavailable.',
  RUNTIME_VERSION_MISMATCH: 'Supervisor runtime version is incompatible.',
  GRANT_NOT_ACTIVE: 'The local resource Grant is not active.',
  GRANT_REVISION_MISMATCH: 'The local resource Grant revision changed.',
  GRANT_SCOPE_MISMATCH: 'The local resource Grant does not cover this subject.',
  CAPABILITY_DENIED: 'The requested local capability is not allowed.',
  TARGET_IDENTITY_CHANGED: 'The selected local resource identity changed.',
  DEADLINE_EXPIRED: 'The local capability deadline expired.',
  OUTCOME_UNKNOWN: 'The local capability outcome is unknown.',
  INVALID_REQUEST: 'The Supervisor control request is invalid.',
  OPERATION_CONFLICT: 'The operation identity was reused with different input.',
  NOT_FOUND: 'The requested Supervisor record was not found.',
}

/** Abstract Host-only control plane for Supervisor-owned Grants, reads, and Receipts. */
export abstract class SupervisorControlPort extends Service {
  /** Register the service as `ctx.aistaffSupervisorControl`. */
  constructor(ctx: Context) {
    super(ctx, SUPERVISOR_CONTROL_SERVICE_KEY)
  }

  /**
   * Read protocol, platform, limits, capabilities, and the current Host context.
   * @returns the path-free Supervisor handshake.
   */
  abstract hello(): Promise<SupervisorHello>

  /**
   * Register one user-selected resource root on the privileged Host hop.
   * @param input - exact idempotent registration, including the only public root path field.
   * @returns a path-free Grant and registration Receipt.
   */
  abstract registerGrant(input: SupervisorGrantRegister): Promise<SupervisorGrantResult>

  /**
   * Revoke one exact active Grant revision.
   * @param input - idempotent revocation precondition.
   * @returns the revocation Receipt.
   */
  abstract revokeGrant(input: SupervisorGrantRevoke): Promise<SupervisorReceipt>

  /**
   * Execute one bounded read under an active Grant.
   * @param input - execution context, subject, Grant, intent, relative target, limit, and deadline.
   * @returns a bounded path-free payload and Receipt.
   */
  abstract readCapability(input: ReadCapabilityRequest): Promise<ReadCapabilityResult>

  /**
   * Read one retained Receipt.
   * @param input - opaque Receipt identity.
   * @returns the retained path-free Receipt.
   */
  abstract getReceipt(input: { readonly receipt_ref: SupervisorReceiptRefType }): Promise<SupervisorReceipt>

  /**
   * Reconcile one original idempotent operation.
   * @param input - original operation identity.
   * @returns the retained operation status without re-executing it.
   */
  abstract readOperation(input: { readonly operation_id: SupervisorOperationIdType }): Promise<SupervisorOperationStatus>
}

/** Brand a raw operation identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorOperationId = (value: string): SupervisorOperationIdType => value as SupervisorOperationIdType
/** Brand a raw capability-context handle without changing its JSON representation.
 * @param value - raw opaque handle.
 * @returns the branded handle.
 */
export const CapabilityContextHandle = (value: string): CapabilityContextHandleType => value as CapabilityContextHandleType
/** Brand a raw runtime handle without changing its JSON representation.
 * @param value - raw opaque handle.
 * @returns the branded handle.
 */
export const SupervisorRuntimeHandle = (value: string): SupervisorRuntimeHandleType => value as SupervisorRuntimeHandleType
/** Brand a raw Grant handle without changing its JSON representation.
 * @param value - raw opaque handle.
 * @returns the branded handle.
 */
export const SupervisorGrantHandle = (value: string): SupervisorGrantHandleType => value as SupervisorGrantHandleType
/** Brand a raw Grant revision without changing its JSON representation.
 * @param value - raw opaque revision.
 * @returns the branded revision.
 */
export const SupervisorGrantRevision = (value: string): SupervisorGrantRevisionType => value as SupervisorGrantRevisionType
/** Brand a raw Receipt identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorReceiptRef = (value: string): SupervisorReceiptRefType => value as SupervisorReceiptRefType
/** Brand a raw root fingerprint without changing its JSON representation.
 * @param value - raw opaque fingerprint.
 * @returns the branded fingerprint.
 */
export const SupervisorRootFingerprint = (value: string): SupervisorRootFingerprintType => value as SupervisorRootFingerprintType
/** Brand a raw evidence identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorEvidenceRef = (value: string): SupervisorEvidenceRefType => value as SupervisorEvidenceRefType
/** Brand a raw local activity identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorActivityRef = (value: string): SupervisorActivityRefType => value as SupervisorActivityRefType
/** Brand a raw DSH Session identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorDshSessionId = (value: string): SupervisorDshSessionIdType => value as SupervisorDshSessionIdType
/** Brand a raw Tenant identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorTenantId = (value: string): SupervisorTenantIdType => value as SupervisorTenantIdType
/** Brand a raw device-session identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorDeviceSessionId = (value: string): SupervisorDeviceSessionIdType => value as SupervisorDeviceSessionIdType
/** Brand a raw Cloud run identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorRunId = (value: string): SupervisorRunIdType => value as SupervisorRunIdType
/** Brand a raw Cloud step identity without changing its JSON representation.
 * @param value - raw opaque identity.
 * @returns the branded identity.
 */
export const SupervisorStepId = (value: string): SupervisorStepIdType => value as SupervisorStepIdType

export default SupervisorControlPort
