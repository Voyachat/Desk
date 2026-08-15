/**
 * Renderer-safe AI employee experience Service Definition and observable object layer.
 * @module @deepseek-ai/dsh-aistaff-employee-experience
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ActivityView,
  EmployeeExperienceListener,
  EmployeeExperienceObservation,
  EmployeeExperienceSnapshot,
  EngagementPage,
  EngagementPageInput,
  EngagementRef as EngagementRefType,
  EngagementSnapshot,
  EngagementView,
  InteractionResponseInput,
  MaterialAccessGrant,
  MaterialAccessInput,
  OpenEngagementInput,
  OperationId as OperationIdType,
  OperationStatusView,
  ProductResult,
  SubmitEmployeeInput,
} from './types.ts'

export type * from './types.ts'

/** Stable Cordis key for the Renderer-facing product capability. */
export const EMPLOYEE_EXPERIENCE_SERVICE_KEY = 'employeeExperience' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Renderer-safe AI employee business projection and user operations. */
    employeeExperience: EmployeeExperiencePort
  }
}

/** Deep-freeze one already-cloned JSON-compatible value. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** Detach one provider-owned snapshot and make every nested value immutable. */
function immutableSnapshot(snapshot: EmployeeExperienceSnapshot): EmployeeExperienceSnapshot {
  return deepFreeze(structuredClone(snapshot))
}

/** Validate the process-local replacement sequence. */
function requireGeneration(generation: number, previous?: number): void {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TypeError('employee experience view_generation must be a non-negative safe integer')
  }
  if (previous !== undefined && generation <= previous) {
    throw new Error(`employee experience view_generation ${String(generation)} must be greater than ${String(previous)}`)
  }
}

/**
 * Renderer-facing AI employee capability. Providers own Cloud or local I/O;
 * Consumers receive only display-safe DTOs and opaque identities.
 */
export abstract class EmployeeExperiencePort extends Service {
  /**
   * Register one provider implementation at the stable Cordis key.
   * @param ctx - Cordis context that owns the provider.
   */
  protected constructor(ctx: Context) {
    super(ctx, EMPLOYEE_EXPERIENCE_SERVICE_KEY)
  }

  /**
   * Atomically register a replacement listener and read the current snapshot.
   * The listener receives future complete replacements only.
   * @param listener - synchronous contained replacement callback.
   * @returns the current immutable snapshot and an idempotent disposer.
   */
  abstract observe(listener: EmployeeExperienceListener): EmployeeExperienceObservation

  /**
   * Read a local page of collaboration summaries from the current projection.
   * @param input - zero-based local offset and bounded page size.
   * @returns a page detached from Host recovery state.
   */
  abstract listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>>

  /**
   * Open one collaboration through the authoritative owner.
   * @param input - idempotency identity, selected employee, and optional title.
   * @returns the created collaboration or a display-safe failure.
   */
  abstract openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>>

  /**
   * Load complete current detail for one collaboration.
   * @param input - selected opaque collaboration identity.
   * @returns the loaded replacement or a display-safe failure.
   */
  abstract readEngagement(input: { readonly engagement_ref: EngagementRefType }): Promise<ProductResult<EngagementSnapshot>>

  /**
   * Submit one user input as a single idempotent visible activity.
   * @param input - collaboration, input parts, operation identity, and revision precondition.
   * @returns the accepted activity or a display-safe failure.
   */
  abstract submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>>

  /**
   * Respond to one pending interaction exactly once.
   * @param input - selected outcome, values, optional local consent, and revision precondition.
   * @returns the committed display receipt or a display-safe failure.
   */
  abstract respondInteraction(input: InteractionResponseInput): Promise<ProductResult<import('./types.ts').EffectReceiptView>>

  /**
   * Request short-lived controlled access to one material.
   * @param input - material, action, purpose, operation identity, and revision precondition.
   * @returns access metadata or a display-safe failure.
   */
  abstract createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>>

  /**
   * Reconcile the outcome of one original idempotent operation.
   * @param input - original operation identity.
   * @returns retained operation status or a display-safe failure.
   */
  abstract readOperation(input: { readonly operation_id: OperationIdType }): Promise<ProductResult<OperationStatusView>>
}

/**
 * Shared object layer for production providers. It owns the Renderer business
 * projection, enforces monotonic complete replacements, atomically combines
 * the initial read with listener registration, and contains listener failures.
 */
export abstract class EmployeeExperienceObjectLayer extends EmployeeExperiencePort {
  private current: EmployeeExperienceSnapshot
  private readonly listeners = new Set<EmployeeExperienceListener>()

  /**
   * Create an object layer from one complete initial projection.
   * @param ctx - Cordis context that owns the provider.
   * @param initial - initial complete Renderer-safe projection.
   */
  protected constructor(ctx: Context, initial: EmployeeExperienceSnapshot) {
    super(ctx)
    requireGeneration(initial.view_generation)
    this.current = immutableSnapshot(initial)
  }

  /**
   * Atomically register a listener and capture the matching current snapshot.
   * @param listener - synchronous contained replacement callback.
   * @returns the matching initial snapshot and caller-owned disposer.
   */
  override observe(listener: EmployeeExperienceListener): EmployeeExperienceObservation {
    let snapshot: EmployeeExperienceSnapshot | undefined
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      snapshot = this.current
      return () => {
        this.listeners.delete(listener)
      }
    }, 'employeeExperience.observe()')
    if (snapshot === undefined) {
      throw new Error('employee experience observer effect did not initialize synchronously')
    }
    return Object.freeze({
      snapshot,
      dispose: () => { void dispose() },
    })
  }

  /**
   * Commit and publish one complete Renderer-safe replacement. The source is
   * detached before publication and later source mutations cannot affect it.
   * @param next - complete projection with a strictly newer generation.
   */
  protected publishReplacement(next: EmployeeExperienceSnapshot): void {
    requireGeneration(next.view_generation, this.current.view_generation)
    const replacement = immutableSnapshot(next)
    this.current = replacement
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(replacement)
      } catch (error) {
        this.ctx.logger.warn('employee experience replacement listener failed')
        this.ctx.logger.warn(error)
      }
    }
  }

  /**
   * Read the exact immutable projection currently owned by this layer.
   * Providers use this only to derive local reads or a next complete replacement.
   * @returns the current immutable projection.
   */
  protected currentSnapshot(): EmployeeExperienceSnapshot {
    return this.current
  }
}

export default EmployeeExperiencePort

/**
 * Brand a raw employee identity without changing its JSON representation.
 * @param value - opaque employee identity supplied by an admitted provider.
 * @returns the same string with the employee brand.
 */
export const EmployeeRef = (value: string): import('./types.ts').EmployeeRef => value as import('./types.ts').EmployeeRef
/**
 * Brand a raw collaboration identity without changing its JSON representation.
 * @param value - opaque collaboration identity supplied by an admitted provider.
 * @returns the same string with the collaboration brand.
 */
export const EngagementRef = (value: string): import('./types.ts').EngagementRef => value as import('./types.ts').EngagementRef
/**
 * Brand a raw activity identity without changing its JSON representation.
 * @param value - opaque activity identity supplied by an admitted provider.
 * @returns the same string with the activity brand.
 */
export const ActivityRef = (value: string): import('./types.ts').ActivityRef => value as import('./types.ts').ActivityRef
/**
 * Brand a raw material identity without changing its JSON representation.
 * @param value - opaque material identity supplied by an admitted provider.
 * @returns the same string with the material brand.
 */
export const MaterialRef = (value: string): import('./types.ts').MaterialRef => value as import('./types.ts').MaterialRef
/**
 * Brand a raw interaction identity without changing its JSON representation.
 * @param value - opaque interaction identity supplied by an admitted provider.
 * @returns the same string with the interaction brand.
 */
export const InteractionRef = (value: string): import('./types.ts').InteractionRef => value as import('./types.ts').InteractionRef
/**
 * Brand a raw receipt identity without changing its JSON representation.
 * @param value - opaque receipt identity supplied by an admitted provider.
 * @returns the same string with the receipt brand.
 */
export const ReceiptRef = (value: string): import('./types.ts').ReceiptRef => value as import('./types.ts').ReceiptRef
/**
 * Brand a raw operation identity without changing its JSON representation.
 * @param value - opaque idempotent operation identity created by the Host.
 * @returns the same string with the operation brand.
 */
export const OperationId = (value: string): import('./types.ts').OperationId => value as import('./types.ts').OperationId
/**
 * Brand a raw material grant identity without changing its JSON representation.
 * @param value - opaque material grant identity supplied by an admitted provider.
 * @returns the same string with the material grant brand.
 */
export const MaterialAccessGrantRef = (value: string): import('./types.ts').MaterialAccessGrantRef => value as import('./types.ts').MaterialAccessGrantRef
/**
 * Brand a raw content identity without changing its JSON representation.
 * @param value - opaque controlled content identity supplied by an admitted provider.
 * @returns the same string with the content brand.
 */
export const ContentRef = (value: string): import('./types.ts').ContentRef => value as import('./types.ts').ContentRef
/**
 * Brand a raw artifact identity without changing its JSON representation.
 * @param value - opaque artifact identity supplied by an admitted provider.
 * @returns the same string with the artifact brand.
 */
export const ArtifactRef = (value: string): import('./types.ts').ArtifactRef => value as import('./types.ts').ArtifactRef
/**
 * Brand a raw local resource identity without changing its JSON representation.
 * @param value - opaque local resource identity issued by a trusted Host surface.
 * @returns the same string with the local resource brand.
 */
export const LocalResourceHandleRef = (value: string): import('./types.ts').LocalResourceHandleRef => value as import('./types.ts').LocalResourceHandleRef
/**
 * Brand a raw local consent identity without changing its JSON representation.
 * @param value - opaque local consent identity issued by the Host.
 * @returns the same string with the local consent brand.
 */
export const LocalConsentRef = (value: string): import('./types.ts').LocalConsentRef => value as import('./types.ts').LocalConsentRef
/**
 * Brand a raw owner revision without changing its JSON representation.
 * @param value - opaque owner revision supplied by an admitted provider.
 * @returns the same string with the owner-revision brand.
 */
export const OwnerRevision = (value: string): import('./types.ts').OwnerRevision => value as import('./types.ts').OwnerRevision
