/**
 * Strict Typert Remote methods backed by the authoritative Aistaff Host projection.
 * @module @deepseek-ai/dsh-aistaff-product-remote
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  CreateTaskInput,
  ProductProjectionSnapshot,
  ProductResult,
  Receipt,
  RespondApprovalInput,
  Task,
} from '@deepseek-ai/dsh-aistaff-product-contracts'
import type {} from '@deepseek-ai/dsh-aistaff-product-projection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Typert service exposing the Aistaff product projection. */
    aistaffProductRemote: AistaffProductRemoteService
  }
}

/**
 * Direct Remote facade over `ctx.aistaffProduct`. Generated strict codecs own
 * wire validation; this service adds no second state or fallback behavior.
 */
export class AistaffProductRemoteService extends TypertRemoteService {
  static inject = ['aistaffProduct']

  /**
   * Register the Host service under `aistaffProductRemote` while publishing
   * the shorter `aistaffProduct` wire namespace.
   * @param ctx - Host context carrying the product projection.
   */
  constructor(ctx: Context) {
    super(ctx, 'aistaffProductRemote', { namespace: 'aistaffProduct' })
  }

  /**
   * Read the complete authoritative product snapshot.
   * @returns the projection's business result unchanged.
   */
  @Remote('getSnapshot')
  getSnapshot(): Promise<ProductResult<ProductProjectionSnapshot>> {
    return this.ctx.aistaffProduct.getSnapshot()
  }

  /**
   * Create one local task and pending approval.
   * @param input - strictly decoded task request.
   * @returns the projection's business result unchanged.
   */
  @Remote('createTask')
  createTask(input: CreateTaskInput): Promise<ProductResult<Task>> {
    return this.ctx.aistaffProduct.createTask(input)
  }

  /**
   * Settle one pending approval exactly once.
   * @param input - strictly decoded approval response.
   * @returns the projection's business result unchanged.
   */
  @Remote('respondApproval')
  respondApproval(input: RespondApprovalInput): Promise<ProductResult<Receipt>> {
    return this.ctx.aistaffProduct.respondApproval(input)
  }
}

export default AistaffProductRemoteService
