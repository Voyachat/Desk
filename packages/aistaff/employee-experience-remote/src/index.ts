/**
 * Strict Host Typert Remote for the Renderer-safe Employee Experience service.
 * @module @voyaseek-ai/dsh-aistaff-employee-experience-remote
 */

import { Context } from '@voyaseek-ai/cordis'
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
  ProductResult,
  SubmitEmployeeInput,
} from '@voyaseek-ai/dsh-aistaff-employee-experience/types'
import type {} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import { Remote, TypertRemoteService } from '@voyaseek-ai/dsh-typert-protocol'

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Host Typert facade for Renderer-safe employee operations. */
    employeeExperienceRemote: EmployeeExperienceRemoteService
  }
}

/**
 * Direct Remote facade over the authoritative Host Employee Experience port.
 * Generated strict codecs own wire validation; recovery metadata never enters
 * these methods.
 */
export class EmployeeExperienceRemoteService extends TypertRemoteService {
  static inject = ['employeeExperience']

  /**
   * Register the Host facade under a distinct service key and publish the
   * `employeeExperience` wire namespace.
   * @param ctx - Host context carrying the authoritative object layer.
   */
  constructor(ctx: Context) {
    super(ctx, 'employeeExperienceRemote', { namespace: 'employeeExperience' })
  }

  /**
   * Atomically capture the current complete snapshot without retaining a
   * listener after the read.
   * @returns the current complete Renderer-safe replacement.
   */
  @Remote('getSnapshot')
  async getSnapshot(): Promise<ProductResult<EmployeeExperienceSnapshot>> {
    const observation = this.ctx.employeeExperience.observe(() => {})
    try {
      return { ok: true, value: observation.snapshot }
    } finally {
      observation.dispose()
    }
  }

  /**
   * Read one Host-owned page of collaboration summaries.
   * @param input - local offset and bounded page size.
   * @returns the page or a display-safe product failure.
   */
  @Remote('listEngagements')
  listEngagements(input: EngagementPageInput): Promise<ProductResult<EngagementPage>> {
    return this.ctx.employeeExperience.listEngagements(input)
  }

  /**
   * Open one collaboration through the authoritative Host provider.
   * @param input - idempotent operation, employee, and optional title.
   * @returns the opened collaboration or a display-safe product failure.
   */
  @Remote('openEngagement')
  openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>> {
    return this.ctx.employeeExperience.openEngagement(input)
  }

  /**
   * Read the complete current detail for one collaboration.
   * @param input - opaque collaboration identity.
   * @returns the collaboration detail or a display-safe product failure.
   */
  @Remote('readEngagement')
  readEngagement(input: { readonly engagement_ref: EngagementRef }): Promise<ProductResult<EngagementSnapshot>> {
    return this.ctx.employeeExperience.readEngagement(input)
  }

  /**
   * Submit one user input to an existing collaboration.
   * @param input - idempotent input parts and revision precondition.
   * @returns the accepted activity or a display-safe product failure.
   */
  @Remote('submitInput')
  submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>> {
    return this.ctx.employeeExperience.submitInput(input)
  }

  /**
   * Respond exactly once to one pending employee interaction.
   * @param input - outcome, values, operation identity, and revision precondition.
   * @returns the committed receipt or a display-safe product failure.
   */
  @Remote('respondInteraction')
  respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>> {
    return this.ctx.employeeExperience.respondInteraction(input)
  }

  /**
   * Request short-lived controlled access to one material.
   * @param input - material action, purpose, operation identity, and revision.
   * @returns the access grant or a display-safe product failure.
   */
  @Remote('createMaterialAccess')
  createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>> {
    return this.ctx.employeeExperience.createMaterialAccess(input)
  }

  /**
   * Reconcile one original idempotent operation without creating another.
   * @param input - original operation identity.
   * @returns the retained operation status or a display-safe product failure.
   */
  @Remote('readOperation')
  readOperation(input: { readonly operation_id: OperationId }): Promise<ProductResult<OperationStatusView>> {
    return this.ctx.employeeExperience.readOperation(input)
  }
}

export default EmployeeExperienceRemoteService
