/**
 * Browser adapter from generated local capability methods to the observable object layer.
 * @module @deepseek-ai/dsh-aistaff-local-capability-remote/client
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  OperationId,
  OperationStatusView,
  ProductError,
  ProductResult,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import { LocalCapabilityObjectLayer } from '@deepseek-ai/dsh-aistaff-local-capability/object-layer'
import type {
  AuthorizeLocalOperationInput,
  LocalCapabilityReceiptView,
  LocalCapabilitySnapshot,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from '@deepseek-ai/dsh-aistaff-local-capability/types'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { assertLocalCapabilityWireValue } from '../wire.ts'

/** Generated Remote calls consumed by the Client object-layer provider. */
export interface LocalCapabilityRemoteNamespace {
  /** Read one complete Host replacement. */
  getSnapshot(): Promise<RemoteResult<ProductResult<LocalCapabilitySnapshot>>>
  /** Select a trusted Host directory. */
  selectDirectory(input: SelectDirectoryInput): Promise<RemoteResult<ProductResult<SelectDirectoryResult>>>
  /** Authorize one local operation. */
  authorizeLocalOperation(input: AuthorizeLocalOperationInput): Promise<RemoteResult<ProductResult<LocalCapabilityReceiptView>>>
  /** Revoke one opaque local resource. */
  revokeResource(input: RevokeResourceInput): Promise<RemoteResult<ProductResult<LocalCapabilityReceiptView>>>
  /** Reconcile one original operation. */
  readOperation(input: { readonly operation_id: OperationId }): Promise<RemoteResult<ProductResult<OperationStatusView>>>
}

/** Transport-level Remote failure, distinct from a Host ProductError. */
export class LocalCapabilityRemoteError extends Error {
  /** Carrier error code. */
  readonly code: string
  /** Carrier-safe structured details. */
  readonly details: object

  /**
   * @param failure - failure envelope returned by the Remote carrier.
   */
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'LocalCapabilityRemoteError'
    this.code = failure.code
    this.details = failure.details
  }
}

/** Product failure encountered while fetching the mandatory full snapshot. */
export class LocalCapabilityRefreshProductError extends Error {
  /** Display-safe Host business error. */
  readonly productError: ProductError

  /**
   * @param productError - Host business failure returned by getSnapshot.
   */
  constructor(productError: ProductError) {
    super(productError.message)
    this.name = 'LocalCapabilityRefreshProductError'
    this.productError = productError
  }
}

/** Invalid, regressing, or privileged Renderer payload. */
export class LocalCapabilityReplacementError extends Error {
  /**
   * @param message - stable local replacement failure.
   */
  constructor(message: string) {
    super(message)
    this.name = 'LocalCapabilityReplacementError'
  }
}

function unwrap<T>(result: RemoteResult<ProductResult<T>>): ProductResult<T> {
  if (!result.ok) throw new LocalCapabilityRemoteError(result.error)
  try {
    assertLocalCapabilityWireValue(result.value)
  } catch (error) {
    throw new LocalCapabilityReplacementError(error instanceof Error ? error.message : 'invalid local capability wire value')
  }
  return result.value
}

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

function replacementKind(
  current: LocalCapabilitySnapshot,
  next: LocalCapabilitySnapshot,
): 'same' | 'newer' {
  if (!Number.isSafeInteger(next.view_generation) || next.view_generation < 0) {
    throw new LocalCapabilityReplacementError(
      'local capability remote: view_generation must be a non-negative safe integer',
    )
  }
  if (next.view_generation < current.view_generation) {
    throw new LocalCapabilityReplacementError(
      `local capability remote: view_generation ${String(next.view_generation)} cannot replace ${String(current.view_generation)}`,
    )
  }
  if (next.view_generation === current.view_generation) {
    if (sameValue(current, next)) return 'same'
    throw new LocalCapabilityReplacementError(
      `local capability remote: divergent snapshot reused view_generation ${String(next.view_generation)}`,
    )
  }
  return 'newer'
}

/** Client provider backed only by complete Host replacements and explicit calls. */
export class LocalCapabilityRemoteClientPort extends LocalCapabilityObjectLayer {
  private constructor(
    ctx: Context,
    private readonly remote: LocalCapabilityRemoteNamespace,
    initial: LocalCapabilitySnapshot,
  ) {
    super(ctx, initial)
  }

  /**
   * Fetch the mandatory Host baseline before registering `localCapability`.
   * @param ctx - Client context that will own the initialized service.
   * @param remote - mounted generated Remote namespace.
   * @returns the registered and initialized object layer.
   */
  static async create(
    ctx: Context,
    remote: LocalCapabilityRemoteNamespace,
  ): Promise<LocalCapabilityRemoteClientPort> {
    return new LocalCapabilityRemoteClientPort(ctx, remote, await readRemoteSnapshot(remote))
  }

  /**
   * Select one trusted Host directory and refresh the complete projection.
   * @param input - opaque interaction, slot, and original operation identity.
   * @returns cancellation or a display-safe selected resource.
   */
  override selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    return this.invokeAndRefresh(input, () => this.remote.selectDirectory(input))
  }

  /**
   * Authorize one reviewed local operation and refresh the complete projection.
   * @param input - resource identity and exact reviewed revisions.
   * @returns the sanitized operation receipt or business failure.
   */
  override authorizeLocalOperation(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    return this.invokeAndRefresh(input, () => this.remote.authorizeLocalOperation(input))
  }

  /**
   * Revoke one reviewed resource and refresh the complete projection.
   * @param input - resource identity, revision, and original operation identity.
   * @returns the sanitized revocation receipt or business failure.
   */
  override revokeResource(input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>> {
    return this.invokeAndRefresh(input, () => this.remote.revokeResource(input))
  }

  /**
   * Reconcile one operation and refresh the complete projection.
   * @param input - original operation identity.
   * @returns retained operation state or business failure.
   */
  override readOperation(
    input: { readonly operation_id: OperationId },
  ): Promise<ProductResult<OperationStatusView>> {
    return this.invokeAndRefresh(input, () => this.remote.readOperation(input))
  }

  private async invokeAndRefresh<T>(
    input: { readonly operation_id: OperationId },
    invoke: () => Promise<RemoteResult<ProductResult<T>>>,
  ): Promise<ProductResult<T>> {
    const operationId = input.operation_id
    const result = unwrap(await invoke())
    if (!result.ok) return result
    if (input.operation_id !== operationId) {
      throw new LocalCapabilityReplacementError('local capability remote: operation changed operation_id')
    }
    await this.refreshSnapshot()
    return result
  }

  private async refreshSnapshot(): Promise<void> {
    const next = await readRemoteSnapshot(this.remote)
    if (replacementKind(this.currentSnapshot(), next) === 'newer') this.publishReplacement(next)
  }
}

async function readRemoteSnapshot(remote: LocalCapabilityRemoteNamespace): Promise<LocalCapabilitySnapshot> {
  const result = unwrap(await remote.getSnapshot())
  if (!result.ok) throw new LocalCapabilityRefreshProductError(result.error)
  return result.value
}

/** Required mounted Remote namespace. */
export const inject = ['remote.localCapability']

/**
 * Register the Remote-backed object layer after the mandatory initial refresh.
 * @param ctx - Client context carrying the mounted generated namespace.
 */
export async function apply(ctx: Context): Promise<void> {
  const remote = ctx.get('remote.localCapability') as LocalCapabilityRemoteNamespace | undefined
  if (remote === undefined) throw new Error('local capability remote: remote.localCapability is not mounted')
  await LocalCapabilityRemoteClientPort.create(ctx, remote)
}
