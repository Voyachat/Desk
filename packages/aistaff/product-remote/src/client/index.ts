/**
 * Browser adapter from the generated Aistaff Remote namespace to `AistaffClientPort`.
 * @module @voyaseek-ai/dsh-aistaff-product-remote/client
 */

import { Context, Service } from '@voyaseek-ai/cordis'
import type {
  AistaffClientPort,
  CreateTaskInput,
  ProductProjectionListener,
  ProductProjectionSnapshot,
  ProductResult,
  Receipt,
  RespondApprovalInput,
  Task,
} from '@voyaseek-ai/dsh-aistaff-product-contracts'
import type { RemoteFailure, RemoteResult } from '@voyaseek-ai/dsh-typert-protocol'

/** Generated Remote calls consumed by the Client port adapter. */
export interface AistaffProductRemoteNamespace {
  /** Read the current Host baseline. */
  getSnapshot(): Promise<RemoteResult<ProductResult<ProductProjectionSnapshot>>>
  /** Create one local task. */
  createTask(input: CreateTaskInput): Promise<RemoteResult<ProductResult<Task>>>
  /** Respond to one pending approval. */
  respondApproval(input: RespondApprovalInput): Promise<RemoteResult<ProductResult<Receipt>>>
}

/** Transport-level Remote failure kept separate from product business errors. */
export class AistaffProductRemoteError extends Error {
  /** Carrier error code. */
  readonly code: string
  /** Carrier-safe structured details. */
  readonly details: object

  /**
   * Construct a Client-visible transport failure.
   * @param failure - error envelope returned by the Remote carrier.
   */
  constructor(failure: RemoteFailure) {
    super(failure.message)
    this.name = 'AistaffProductRemoteError'
    this.code = failure.code
    this.details = failure.details
  }
}

/** Return the business result or reject the operation on a carrier failure. */
function unwrap<T>(result: RemoteResult<ProductResult<T>>): ProductResult<T> {
  if (!result.ok) throw new AistaffProductRemoteError(result.error)
  return result.value
}

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Renderer-facing Aistaff product port backed by Host Remote calls. */
    aistaffProductPort: AistaffRemoteClientPort
  }
}

/** Client service implementing the shared product port over generated Remote methods. */
export class AistaffRemoteClientPort extends Service implements AistaffClientPort {
  /**
   * Register the Client port.
   * @param ctx - Client context that owns the service.
   * @param remote - mounted generated Remote namespace.
   */
  constructor(ctx: Context, private readonly remote: AistaffProductRemoteNamespace) {
    super(ctx, 'aistaffProductPort')
  }

  /** @inheritdoc */
  async getSnapshot(): Promise<ProductResult<ProductProjectionSnapshot>> {
    return unwrap(await this.remote.getSnapshot())
  }

  /** @inheritdoc */
  async createTask(input: CreateTaskInput): Promise<ProductResult<Task>> {
    return unwrap(await this.remote.createTask(input))
  }

  /** @inheritdoc */
  async respondApproval(input: RespondApprovalInput): Promise<ProductResult<Receipt>> {
    return unwrap(await this.remote.respondApproval(input))
  }

  /**
   * The UI fixture does not forward events through the shared Remote allowlist.
   * Mutations are followed by `getSnapshot()` by the current Client consumer.
   * @param _listener - reserved listener that receives no fabricated event.
   * @returns a no-op disposer.
   */
  subscribe(_listener: ProductProjectionListener): () => void {
    return () => {}
  }
}

/** Required mounted Remote namespace. */
export const inject = ['remote.aistaffProduct']

/**
 * Register the Remote-backed Client port service.
 * @param ctx - Client context carrying the mounted namespace service.
 */
export function apply(ctx: Context): void {
  const remote = ctx.get('remote.aistaffProduct') as AistaffProductRemoteNamespace | undefined
  if (remote === undefined) {
    throw new Error('aistaff product remote: remote.aistaffProduct is not mounted')
  }
  new AistaffRemoteClientPort(ctx, remote)
}
