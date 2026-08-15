/**
 * Strict Host Typert Remote for the Renderer-safe local capability service.
 * @module @deepseek-ai/dsh-aistaff-local-capability-remote
 */

import { Context } from '@deepseek-ai/cordis'
import type {
  OperationId,
  OperationStatusView,
  ProductResult,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import type {
  AuthorizeLocalOperationInput,
  LocalCapabilityReceiptView,
  LocalCapabilitySnapshot,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from '@deepseek-ai/dsh-aistaff-local-capability/types'
import type {} from '@deepseek-ai/dsh-aistaff-local-capability'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { assertLocalCapabilityWireValue } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Typert facade for Renderer-safe local capability operations. */
    localCapabilityRemote: LocalCapabilityRemoteService
  }
}

function wireSafe<T>(value: T): T {
  assertLocalCapabilityWireValue(value)
  return value
}

/** Direct Remote facade over the authoritative Host local capability port. */
export class LocalCapabilityRemoteService extends TypertRemoteService {
  static inject = ['localCapability']

  /**
   * Register the Host facade and publish the `localCapability` namespace.
   * @param ctx - Host context carrying the authoritative local capability port.
   */
  constructor(ctx: Context) {
    super(ctx, 'localCapabilityRemote', { namespace: 'localCapability' })
  }

  /**
   * Atomically capture the complete snapshot and immediately release the observer.
   * @returns the current complete Renderer-safe replacement.
   */
  @Remote('getSnapshot')
  async getSnapshot(): Promise<ProductResult<LocalCapabilitySnapshot>> {
    const observation = this.ctx.localCapability.observe(() => {})
    try {
      return wireSafe({ ok: true, value: observation.snapshot })
    } finally {
      observation.dispose()
    }
  }

  /**
   * Open the trusted Host directory selector for one authoritative resource slot.
   * @param input - opaque interaction, slot, and original operation identity.
   * @returns cancellation or a display-safe resource and consent.
   */
  @Remote('selectDirectory')
  async selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    return wireSafe(await this.ctx.localCapability.selectDirectory(input))
  }

  /**
   * Authorize and dispatch one authoritative local operation.
   * @param input - opaque resource and exact reviewed revisions.
   * @returns a sanitized local capability receipt.
   */
  @Remote('authorizeLocalOperation')
  async authorizeLocalOperation(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    return wireSafe(await this.ctx.localCapability.authorizeLocalOperation(input))
  }

  /**
   * Revoke one opaque local resource Grant.
   * @param input - Grant identity, revision precondition, and operation identity.
   * @returns a sanitized revocation receipt.
   */
  @Remote('revokeResource')
  async revokeResource(input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>> {
    return wireSafe(await this.ctx.localCapability.revokeResource(input))
  }

  /**
   * Reconcile one original local capability operation.
   * @param input - original operation identity.
   * @returns retained display-safe operation status.
   */
  @Remote('readOperation')
  async readOperation(
    input: { readonly operation_id: OperationId },
  ): Promise<ProductResult<OperationStatusView>> {
    return wireSafe(await this.ctx.localCapability.readOperation(input))
  }
}

export default LocalCapabilityRemoteService
