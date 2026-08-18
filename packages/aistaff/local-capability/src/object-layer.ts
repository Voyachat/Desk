/** Browser-safe local capability Service Definition and replacement object layer. */

import { Context, Service } from '@voyaseek-ai/cordis'
import type {
  OperationId,
  OperationStatusView,
  ProductResult,
} from '@voyaseek-ai/dsh-aistaff-employee-experience/types'
import type {
  AuthorizeLocalOperationInput,
  LocalCapabilityListener,
  LocalCapabilityObservation,
  LocalCapabilityReceiptView,
  LocalCapabilitySnapshot,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from './types.ts'

/** Stable Cordis key for the Renderer-facing local capability. */
export const LOCAL_CAPABILITY_SERVICE_KEY = 'localCapability' as const

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Renderer-safe local resource, consent, receipt, and operation access. */
    localCapability: LocalCapabilityPort
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function immutableSnapshot(snapshot: LocalCapabilitySnapshot): LocalCapabilitySnapshot {
  return deepFreeze(structuredClone(snapshot))
}

function requireGeneration(generation: number, previous?: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError('local capability view_generation must be a non-negative safe integer')
  }
  if (previous !== undefined && generation <= previous) {
    throw new Error(`local capability view_generation ${String(generation)} must be greater than ${String(previous)}`)
  }
}

/** Renderer-facing local capability. Host providers retain all privileged values. */
export abstract class LocalCapabilityPort extends Service {
  /**
   * Register one provider at the stable Cordis key.
   * @param ctx - Cordis context that owns the provider.
   */
  protected constructor(ctx: Context) {
    super(ctx, LOCAL_CAPABILITY_SERVICE_KEY)
  }

  /**
   * Atomically register a replacement listener and read the current snapshot.
   * @param listener - synchronous contained replacement callback.
   * @returns the current immutable snapshot and an idempotent disposer.
   */
  abstract observe(listener: LocalCapabilityListener): LocalCapabilityObservation

  /**
   * Select a directory for one authoritative interaction resource slot.
   * @param input - interaction, slot, and stable operation identity.
   * @returns cancellation or a display-safe resource and pending consent.
   */
  abstract selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>>

  /**
   * Authorize and dispatch the operation currently owned by the interaction.
   * @param input - interaction, resource, revision preconditions, and operation identity.
   * @returns one sanitized Supervisor receipt.
   */
  abstract authorizeLocalOperation(input: AuthorizeLocalOperationInput): Promise<ProductResult<LocalCapabilityReceiptView>>

  /**
   * Revoke one opaque local resource grant.
   * @param input - resource, revision precondition, and stable operation identity.
   * @returns one sanitized Supervisor receipt.
   */
  abstract revokeResource(input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>>

  /**
   * Reconcile the outcome of one original local capability operation.
   * @param input - original operation identity.
   * @returns retained display-safe operation status.
   */
  abstract readOperation(input: { readonly operation_id: OperationId }): Promise<ProductResult<OperationStatusView>>
}

/** Shared complete-replacement object layer for local capability providers. */
export abstract class LocalCapabilityObjectLayer extends LocalCapabilityPort {
  private current: LocalCapabilitySnapshot
  private readonly listeners = new Set<LocalCapabilityListener>()

  /**
   * Create an object layer from one complete initial projection.
   * @param ctx - Cordis context that owns the provider.
   * @param initial - initial complete Renderer-safe projection.
   */
  protected constructor(ctx: Context, initial: LocalCapabilitySnapshot) {
    super(ctx)
    requireGeneration(initial.view_generation)
    this.current = immutableSnapshot(initial)
  }

  /** @inheritdoc */
  override observe(listener: LocalCapabilityListener): LocalCapabilityObservation {
    let snapshot: LocalCapabilitySnapshot | undefined
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      snapshot = this.current
      return () => { this.listeners.delete(listener) }
    }, 'localCapability.observe()')
    if (snapshot === undefined) {
      throw new Error('local capability observer effect did not initialize synchronously')
    }
    return Object.freeze({
      snapshot,
      dispose: () => { void dispose() },
    })
  }

  /**
   * Commit and publish one detached complete replacement.
   * @param next - complete projection with a strictly newer generation.
   */
  protected publishReplacement(next: LocalCapabilitySnapshot): void {
    requireGeneration(next.view_generation, this.current.view_generation)
    const replacement = immutableSnapshot(next)
    this.current = replacement
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(replacement)
      } catch (error) {
        this.ctx.logger.warn('local capability replacement listener failed')
        this.ctx.logger.warn(error)
      }
    }
  }

  /**
   * Read the exact immutable projection owned by this object layer.
   * @returns the current complete projection.
   */
  protected currentSnapshot(): LocalCapabilitySnapshot {
    return this.current
  }
}
