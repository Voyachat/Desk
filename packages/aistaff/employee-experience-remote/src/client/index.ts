/**
 * Browser adapter from generated Employee Experience Remote methods to the
 * observable Renderer object layer.
 * @module @deepseek-ai/dsh-aistaff-employee-experience-remote/client
 */

import { Context } from '@deepseek-ai/cordis'
import { EmployeeExperienceObjectLayer } from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperienceSnapshot,
  EngagementPage,
  EngagementPageInput,
  EngagementRef,
  EngagementSnapshot,
  EngagementView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  OpenEngagementInput,
  OperationId,
  OperationStatusView,
  ProductError,
  ProductResult,
  SubmitEmployeeInput,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

/** Generated Remote calls consumed by the Client object-layer provider. */
export interface EmployeeExperienceRemoteNamespace {
  /** Read one complete Host replacement. */
  getSnapshot(): Promise<RemoteResult<ProductResult<EmployeeExperienceSnapshot>>>
  /** Read one Host-owned page. */
  listEngagements(input: EngagementPageInput): Promise<RemoteResult<ProductResult<EngagementPage>>>
  /** Open one collaboration. */
  openEngagement(input: OpenEngagementInput): Promise<RemoteResult<ProductResult<EngagementView>>>
  /** Read one complete collaboration detail. */
  readEngagement(input: { readonly engagement_ref: EngagementRef }): Promise<RemoteResult<ProductResult<EngagementSnapshot>>>
  /** Submit one employee input. */
  submitInput(input: SubmitEmployeeInput): Promise<RemoteResult<ProductResult<ActivityView>>>
  /** Respond to one interaction. */
  respondInteraction(input: InteractionResponseInput): Promise<RemoteResult<ProductResult<EffectReceiptView>>>
  /** Request controlled material access. */
  createMaterialAccess(input: MaterialAccessInput): Promise<RemoteResult<ProductResult<MaterialAccessGrant>>>
  /** Reconcile one original operation. */
  readOperation(input: { readonly operation_id: OperationId }): Promise<RemoteResult<ProductResult<OperationStatusView>>>
}

/** Transport-level Remote failure, distinct from a Host ProductError. */
export class EmployeeExperienceRemoteError extends Error {
  /** Carrier error code. */
  readonly code: string
  /** Carrier-safe structured details. */
  readonly details: object

  /**
   * @param failure - failure envelope returned by the Remote carrier.
   */
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'EmployeeExperienceRemoteError'
    this.code = failure.code
    this.details = failure.details
  }
}

/** Product failure encountered while refreshing the mandatory full snapshot. */
export class EmployeeExperienceRefreshProductError extends Error {
  /** Display-safe Host business error. */
  readonly productError: ProductError

  /**
   * @param productError - Host business failure returned by getSnapshot.
   */
  constructor(productError: ProductError) {
    super(productError.message)
    this.name = 'EmployeeExperienceRefreshProductError'
    this.productError = productError
  }
}

/** Invalid or ambiguous process-local snapshot progression. */
export class EmployeeExperienceReplacementError extends Error {
  /**
   * @param message - stable local progression failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'EmployeeExperienceReplacementError'
  }
}

const LOADING_SNAPSHOT: EmployeeExperienceSnapshot = Object.freeze({
  state: 'loading',
  workforce: null,
  engagements: Object.freeze([]),
  has_more_engagements: false,
  current_engagement: null,
  view_generation: 0,
})

/** Return a business result or throw only for a carrier failure. */
function unwrap<T>(result: RemoteResult<ProductResult<T>>): ProductResult<T> {
  if (!result.ok) throw new EmployeeExperienceRemoteError(result.error)
  return result.value
}

/** Compare JSON-compatible snapshots without relying on object key order. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => sameValue(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord).sort()
  const rightKeys = Object.keys(rightRecord).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]))
}

/** Validate one full replacement against the current process-local view. */
function replacementKind(
  current: EmployeeExperienceSnapshot,
  next: EmployeeExperienceSnapshot,
): 'same' | 'newer' {
  if (!Number.isSafeInteger(next.view_generation) || next.view_generation < 0) {
    throw new EmployeeExperienceReplacementError(
      'employee experience remote: view_generation must be a non-negative safe integer',
    )
  }
  if (next.view_generation < current.view_generation) {
    throw new EmployeeExperienceReplacementError(
      `employee experience remote: view_generation ${String(next.view_generation)} cannot replace ${String(current.view_generation)}`,
    )
  }
  if (next.view_generation === current.view_generation) {
    if (sameValue(current, next)) return 'same'
    throw new EmployeeExperienceReplacementError(
      `employee experience remote: divergent snapshot reused view_generation ${String(next.view_generation)}`,
    )
  }
  return 'newer'
}

/** Client provider that owns only the complete Renderer business projection. */
export class EmployeeExperienceRemoteClientPort extends EmployeeExperienceObjectLayer {
  private constructor(
    ctx: Context,
    private readonly remote: EmployeeExperienceRemoteNamespace,
    initial: EmployeeExperienceSnapshot,
  ) {
    super(ctx, LOADING_SNAPSHOT)
    this.commitReplacement(initial)
  }

  /**
   * Fetch and validate the mandatory Host baseline before registering the
   * `employeeExperience` service.
   * @param ctx - Client context that will own the service after refresh.
   * @param remote - mounted generated Remote namespace.
   * @returns the registered and initialized object layer.
   */
  static async create(
    ctx: Context,
    remote: EmployeeExperienceRemoteNamespace,
  ): Promise<EmployeeExperienceRemoteClientPort> {
    const initial = await readRemoteSnapshot(remote)
    replacementKind(LOADING_SNAPSHOT, initial)
    return new EmployeeExperienceRemoteClientPort(ctx, remote, initial)
  }

  /** @inheritdoc */
  override async listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    return unwrap(await this.remote.listEngagements(input))
  }

  /** @inheritdoc */
  override openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    return this.mutate(input, () => this.remote.openEngagement(input))
  }

  /** @inheritdoc */
  override async readEngagement(
    input: { readonly engagement_ref: EngagementRef },
  ): Promise<ProductResult<EngagementSnapshot>> {
    const result = unwrap(await this.remote.readEngagement(input))
    if (!result.ok) return result
    await this.refreshSnapshot()
    return result
  }

  /** @inheritdoc */
  override submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    return this.mutate(input, () => this.remote.submitInput(input))
  }

  /** @inheritdoc */
  override respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    return this.mutate(input, () => this.remote.respondInteraction(input))
  }

  /** @inheritdoc */
  override createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    return this.mutate(input, () => this.remote.createMaterialAccess(input))
  }

  /** @inheritdoc */
  override async readOperation(
    input: { readonly operation_id: OperationId },
  ): Promise<ProductResult<OperationStatusView>> {
    return unwrap(await this.remote.readOperation(input))
  }

  private async mutate<T>(
    input: { readonly operation_id: OperationId },
    invoke: () => Promise<RemoteResult<ProductResult<T>>>,
  ): Promise<ProductResult<T>> {
    const operationId = input.operation_id
    const result = unwrap(await invoke())
    if (!result.ok) return result
    if (input.operation_id !== operationId) {
      throw new EmployeeExperienceReplacementError('employee experience remote: mutation changed operation_id')
    }
    await this.refreshSnapshot()
    return result
  }

  private async refreshSnapshot(): Promise<void> {
    this.commitReplacement(await readRemoteSnapshot(this.remote))
  }

  private commitReplacement(next: EmployeeExperienceSnapshot): void {
    if (replacementKind(this.currentSnapshot(), next) === 'newer') this.publishReplacement(next)
  }
}

/** Read a strict baseline while retaining ProductError identity. */
async function readRemoteSnapshot(remote: EmployeeExperienceRemoteNamespace): Promise<EmployeeExperienceSnapshot> {
  const result = unwrap(await remote.getSnapshot())
  if (!result.ok) throw new EmployeeExperienceRefreshProductError(result.error)
  return result.value
}

/** Required mounted Remote namespace. */
export const inject = ['remote.employeeExperience']

/**
 * Register the Remote-backed object layer after its mandatory initial refresh.
 * @param ctx - Client context carrying the mounted generated namespace.
 */
export async function apply(ctx: Context): Promise<void> {
  const remote = ctx.get('remote.employeeExperience') as EmployeeExperienceRemoteNamespace | undefined
  if (remote === undefined) {
    throw new Error('employee experience remote: remote.employeeExperience is not mounted')
  }
  await EmployeeExperienceRemoteClientPort.create(ctx, remote)
}
