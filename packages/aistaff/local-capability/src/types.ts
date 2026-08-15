/**
 * Renderer-safe local capability values and Host-only injected inputs.
 * @module @deepseek-ai/dsh-aistaff-local-capability/types
 */

import type {
  InteractionRef,
  LocalConsentRef,
  LocalOperationRequestView,
  LocalResourceHandleRef,
  MaterialRef,
  OperationId,
  OperationStatusView,
  OwnerRevision,
  ProductResult,
  ReceiptRef,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import type {
  ReadCapabilityResult,
  SupervisorSubjectBinding,
} from '@deepseek-ai/dsh-aistaff-supervisor-control/types'

/** Display-safe state of one Supervisor-owned resource grant. */
export type LocalResourceState = 'active' | 'expired' | 'revoked'

/** One Renderer-safe view of an opaque Supervisor resource grant. */
export interface LocalResourceView {
  /** Opaque resource grant handle. */
  readonly grant_handle: LocalResourceHandleRef
  /** User-selected display label without a location. */
  readonly display_name: string
  /** Resource category admitted by the authoritative interaction. */
  readonly resource_kind: 'file' | 'directory'
  /** Access class admitted by the authoritative interaction. */
  readonly access: 'read'
  /** Opaque Supervisor grant revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 grant expiry time. */
  readonly expires_at: string
  /** Current projected grant state. */
  readonly state: LocalResourceState
}

/** One Host-issued local consent projected without execution details. */
export interface LocalConsentView {
  /** Opaque Host-issued local consent identity. */
  readonly consent_ref: LocalConsentRef
  /** Authoritative interaction covered by this consent. */
  readonly interaction_ref: InteractionRef
  /** Exact resource slot covered by this consent. */
  readonly slot_ref: string
  /** Opaque resource grant covered by this consent. */
  readonly grant_handle: LocalResourceHandleRef
  /** Current consent state. */
  readonly state: 'pending' | 'authorized' | 'denied' | 'expired' | 'revoked'
  /** Interaction revision for which the consent was captured. */
  readonly interaction_revision: OwnerRevision
  /** Resource revision for which the consent was captured. */
  readonly resource_revision: OwnerRevision
  /** UTC RFC 3339 consent expiry time. */
  readonly expires_at: string
}

/** Display-safe projection of one Supervisor receipt. */
export interface LocalCapabilityReceiptView {
  /** Opaque Supervisor receipt identity. */
  readonly receipt_ref: ReceiptRef
  /** Interaction or resource handle associated with the receipt. */
  readonly subject_ref: string
  /** Sanitized operation outcome. */
  readonly status: 'succeeded' | 'failed' | 'rejected' | 'unknown'
  /** Whether a local effect was observed. */
  readonly effect_state: 'none' | 'not_applied' | 'applied' | 'unknown'
  /** Canonical user-visible materials published by the Host result owner. */
  readonly result_material_refs: readonly MaterialRef[]
  /** Stable display-safe failure reason. */
  readonly reason_code?: string
  /** Opaque receipt revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 Supervisor record time. */
  readonly recorded_at: string
}

/** One complete immutable local capability projection. */
export interface LocalCapabilitySnapshot {
  /** Top-level Host readiness. */
  readonly state: 'ready' | 'unavailable'
  /** Complete resource replacement. */
  readonly resources: readonly LocalResourceView[]
  /** Complete consent replacement. */
  readonly consents: readonly LocalConsentView[]
  /** Complete receipt replacement. */
  readonly receipts: readonly LocalCapabilityReceiptView[]
  /** Strictly increasing process-local replacement generation. */
  readonly view_generation: number
  /** UTC RFC 3339 time at which this replacement was committed. */
  readonly observed_at: string
}

/** Replacement listener invoked synchronously with a complete snapshot. */
export type LocalCapabilityListener = (snapshot: LocalCapabilitySnapshot) => void

/** Atomic initial read and replacement subscription. */
export interface LocalCapabilityObservation {
  /** Immutable snapshot current when the listener was registered. */
  readonly snapshot: LocalCapabilitySnapshot
  /** Idempotent caller-owned listener disposer. */
  readonly dispose: () => void
}

/** Input for selecting one native directory for an authoritative slot. */
export interface SelectDirectoryInput {
  /** Authoritative local-operation interaction. */
  readonly interaction_ref: InteractionRef
  /** Requested resource slot inside the interaction. */
  readonly slot_ref: string
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
}

/** Result of a native directory selection. */
export type SelectDirectoryResult =
  | { readonly state: 'cancelled' }
  | {
      readonly state: 'selected'
      /** Renderer-safe resource grant. */
      readonly resource: LocalResourceView
      /** Pending consent bound to the exact interaction and resource revisions. */
      readonly consent: LocalConsentView
    }

/** Input for authorizing and dispatching the authoritative local operation. */
export interface AuthorizeLocalOperationInput {
  /** Authoritative local-operation interaction. */
  readonly interaction_ref: InteractionRef
  /** Previously selected opaque resource grant. */
  readonly grant_handle: LocalResourceHandleRef
  /** Interaction revision the user reviewed. */
  readonly expected_interaction_revision: OwnerRevision
  /** Resource revision the user reviewed. */
  readonly expected_resource_revision: OwnerRevision
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
}

/** Input for revoking one opaque local resource grant. */
export interface RevokeResourceInput {
  /** Resource grant to revoke. */
  readonly grant_handle: LocalResourceHandleRef
  /** Resource revision the user reviewed. */
  readonly expected_revision: OwnerRevision
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
}

/** One authoritative interaction resolver owned by the Host Cloud projection. */
export interface LocalOperationInteractionResolver {
  /**
   * Resolve the current complete local-operation request.
   * @param interactionRef - opaque interaction identity supplied by the Renderer.
   * @returns the current authoritative request or null when it is no longer available.
   */
  resolve(interactionRef: InteractionRef): Promise<AuthoritativeLocalOperation | null>
}

/** Current authoritative local operation plus its verified Supervisor subject. */
export interface AuthoritativeLocalOperation {
  /** Current Cloud-owned local operation request. */
  readonly request: LocalOperationRequestView
  /** Host-derived Supervisor subject; no field originates in the Renderer call. */
  readonly subject: SupervisorSubjectBinding
}

/** Native directory selected in a trusted Host surface. */
export interface HostDirectorySelection {
  /** Actual directory location, consumed only by the Host-to-Supervisor call. */
  readonly root_path: string
  /** Display label safe for the Renderer. */
  readonly display_name: string
}

/** Trusted Host-native directory selection input. */
export interface HostDirectorySelectionInput {
  /** Authoritative interaction. */
  readonly interaction: LocalOperationRequestView
  /** Exact authoritative resource requirement. */
  readonly slot_ref: string
}

/** Trusted native directory selector; no browser fallback is permitted. */
export interface HostDirectorySelector {
  /**
   * Open one native directory chooser.
   * @param input - authoritative interaction and resource slot.
   * @returns a Host-only selection or null when the user cancels.
   */
  selectDirectory(input: HostDirectorySelectionInput): Promise<HostDirectorySelection | null>
}

/** Input consumed by the authoritative Host result owner after a bounded read. */
export interface LocalCapabilityResultInput {
  /** Authoritative local operation that produced the result. */
  readonly interaction: LocalOperationRequestView
  /** Stable original operation identity. */
  readonly operation_id: OperationId
  /** Bounded Host-only Supervisor result; its payload is never projected here. */
  readonly result: ReadCapabilityResult
}

/** Canonical publication result returned to the local capability coordinator. */
export interface LocalCapabilityResultPublication {
  /** Opaque canonical Material identities owned outside this package. */
  readonly material_refs: readonly MaterialRef[]
}

/** Required Host sink that publishes bounded results into the canonical Material owner. */
export interface LocalCapabilityResultSink {
  /**
   * Publish a bounded Supervisor result idempotently under the original operation.
   * @param input - authoritative interaction, operation identity, and bounded result.
   * @returns canonical opaque Material identities.
   */
  publish(input: LocalCapabilityResultInput): Promise<LocalCapabilityResultPublication>
}

/** Explicit deployment limits and time source for the Host coordinator. */
export interface LocalCapabilityCoordinatorOptions {
  /** Grant lifetime after native selection. */
  readonly grant_lifetime_ms: number
  /** Maximum complete result bytes accepted from Supervisor. */
  readonly max_read_bytes: number
  /** Per-read deadline interval. */
  readonly read_timeout_ms: number
  /** Host clock used for expiry and receipt timestamps. */
  readonly now: () => Date
}

/** Stored Renderer-safe status of an idempotent local capability operation. */
export type LocalCapabilityOperationResult = ProductResult<OperationStatusView>
