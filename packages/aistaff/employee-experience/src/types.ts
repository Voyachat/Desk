/**
 * Renderer-safe AI employee experience values shared with a Product Host.
 * @module @deepseek-ai/dsh-aistaff-employee-experience/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one AI employee without exposing its owner representation. */
export type EmployeeRef = Branded<'AistaffEmployeeRef'>

/** Identifies one user-visible collaboration. */
export type EngagementRef = Branded<'AistaffEngagementRef'>

/** Identifies one user input and its visible work. */
export type ActivityRef = Branded<'AistaffActivityRef'>

/** Identifies one user-visible output material. */
export type MaterialRef = Branded<'AistaffMaterialRef'>

/** Identifies one pending or answered user interaction. */
export type InteractionRef = Branded<'AistaffInteractionRef'>

/** Identifies one effect receipt. */
export type ReceiptRef = Branded<'AistaffReceiptRef'>

/** Identifies one idempotent user operation. */
export type OperationId = Branded<'AistaffOperationId'>

/** Identifies one short-lived material access grant. */
export type MaterialAccessGrantRef = Branded<'AistaffMaterialAccessGrantRef'>

/** Identifies controlled material content without exposing a location. */
export type ContentRef = Branded<'AistaffContentRef'>

/** Identifies one owner artifact without exposing its storage representation. */
export type ArtifactRef = Branded<'AistaffArtifactRef'>

/** Identifies a local resource selected through a trusted native surface. */
export type LocalResourceHandleRef = Branded<'AistaffLocalResourceHandleRef'>

/** Identifies a Host-issued local consent decision. */
export type LocalConsentRef = Branded<'AistaffLocalConsentRef'>

/** Opaque owner revision; consumers compare it only for equality. */
export type OwnerRevision = Branded<'AistaffOwnerRevision'>

/** JSON-compatible value admitted by a selected presentation contract. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Reference to one immutable, locally admitted contract definition. */
export interface ContractRef {
  /** Stable contract name. */
  readonly name: string
  /** Compatibility-breaking version. */
  readonly major: number
  /** Additive version selected for this value. */
  readonly minor: number
  /** Logical schema identity inside the admitted artifact. */
  readonly schema_ref: string
  /** Exact admitted schema digest. */
  readonly schema_hash: string
}

/** Host-owned, display-safe failure vocabulary for all service operations. */
export interface ProductError {
  /** Stable behavior class used by UI recovery decisions. */
  readonly code:
    | 'INVALID_REQUEST'
    | 'UNAUTHENTICATED'
    | 'FORBIDDEN'
    | 'DENIED'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'EXPIRED'
    | 'VERSION_MISMATCH'
    | 'UNAVAILABLE'
    | 'UNKNOWN_OUTCOME'
  /** Localized or otherwise display-safe message; never a downstream body. */
  readonly message: string
  /** Whether the same operation may be retried without changing user intent. */
  readonly retryable: boolean
  /** Latest owner revision when recovery requires a fresh read. */
  readonly current_revision?: OwnerRevision
  /** Minimum delay before a safe retry. */
  readonly retry_after_ms?: number
  /** Original operation when its outcome requires reconciliation. */
  readonly operation_id?: OperationId
}

/** Success or display-safe failure returned by every service operation. */
export type ProductResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProductError }

/** One action the current identity may request from an employee. */
export interface AllowedActionView {
  /** Whether the action is currently available. */
  readonly allowed: boolean
  /** Stable explanation when the action is unavailable. */
  readonly reason_code?: string
}

/** User-visible AI employee presentation. */
export interface EmployeeCard {
  /** Stable opaque employee identity. */
  readonly employee_ref: EmployeeRef
  /** Display name supplied by the authoritative workforce projection. */
  readonly display_name: string
  /** Display role supplied by the authoritative workforce projection. */
  readonly role_label: string
  /** Optional display-safe description. */
  readonly description?: string
  /** Optional admitted presentation asset reference. */
  readonly avatar_ref?: ContentRef
  /** Current user-visible availability. */
  readonly availability: 'ready' | 'busy' | 'offline' | 'unknown'
  /** Display labels, not executable capability declarations. */
  readonly capability_labels: readonly string[]
  /** Host-projected actions keyed by stable action name. */
  readonly allowed_actions: Readonly<Record<string, AllowedActionView>>
}

/** Complete Renderer workforce replacement. */
export interface EmployeeWorkforceView {
  /** Opaque owner revision of this complete replacement. */
  readonly revision: OwnerRevision
  /** Employees in the owner-defined display order. */
  readonly employees: readonly EmployeeCard[]
  /** Time at which the Host committed the replacement. */
  readonly observed_at: string
}

/** User-visible collaboration with one employee. */
export interface EngagementView {
  /** Stable opaque collaboration identity. */
  readonly engagement_ref: EngagementRef
  /** Employee selected for the collaboration. */
  readonly employee_ref: EmployeeRef
  /** User-visible title. */
  readonly title: string
  /** Folded display state without execution-engine details. */
  readonly display_state: 'ready' | 'working' | 'waiting_user' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  /** Latest user-visible activity when one exists. */
  readonly latest_activity_ref?: ActivityRef
  /** Opaque owner revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 creation time. */
  readonly created_at: string
  /** UTC RFC 3339 time of the latest owner change. */
  readonly updated_at: string
}

/** One user input and the visible work it initiated. */
export interface ActivityView {
  /** Stable opaque activity identity. */
  readonly activity_ref: ActivityRef
  /** Owning collaboration. */
  readonly engagement_ref: EngagementRef
  /** Employee handling the activity. */
  readonly employee_ref: EmployeeRef
  /** Folded display state without attempts or execution targets. */
  readonly display_state: 'queued' | 'working' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  /** User-visible outputs associated with the activity. */
  readonly material_refs: readonly MaterialRef[]
  /** User interactions associated with the activity. */
  readonly interaction_refs: readonly InteractionRef[]
  /** Opaque owner revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 creation time. */
  readonly created_at: string
  /** UTC RFC 3339 time of the latest owner change. */
  readonly updated_at: string
}

/** Renderer-safe material body. */
export type MaterialBody =
  | { readonly kind: 'text'; readonly format: 'plain_text' | 'markdown'; readonly text: string }
  | { readonly kind: 'structured'; readonly schema_ref: string; readonly value: JsonValue }
  | {
      readonly kind: 'artifact'
      readonly artifact_ref: ArtifactRef
      readonly media_type: string
      readonly byte_size: number
      readonly content_hash: string
    }
  | { readonly kind: 'link'; readonly url: string; readonly label: string }

/** One employee output prepared for safe presentation. */
export interface MaterialView {
  /** Stable opaque material identity. */
  readonly material_ref: MaterialRef
  /** Owning collaboration. */
  readonly engagement_ref: EngagementRef
  /** Activity that produced the material. */
  readonly activity_ref: ActivityRef
  /** User-visible title. */
  readonly title: string
  /** Optional display-safe summary. */
  readonly summary?: string
  /** Admitted body; rendering still applies media-specific safety rules. */
  readonly body: MaterialBody
  /** Product-selected presentation mode. */
  readonly presentation: 'inline' | 'preview' | 'download' | 'external'
  /** Current access state. */
  readonly state: 'available' | 'blocked' | 'expired' | 'revoked' | 'unknown'
  /** Host-projected material actions. */
  readonly allowed_actions: Readonly<Record<string, AllowedActionView>>
  /** Opaque owner revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 creation time. */
  readonly created_at: string
}

/** Fields shared by every user interaction. */
export interface InteractionBase {
  /** Stable opaque interaction identity. */
  readonly interaction_ref: InteractionRef
  /** Owning collaboration. */
  readonly engagement_ref: EngagementRef
  /** Activity waiting on this interaction. */
  readonly activity_ref: ActivityRef
  /** User-visible title. */
  readonly title: string
  /** Display-safe explanation. */
  readonly summary: string
  /** Exact outcome identifiers the owner currently accepts. */
  readonly allowed_outcome_ids: readonly string[]
  /** Opaque owner revision used by a response precondition. */
  readonly revision: OwnerRevision
  /** Optional UTC RFC 3339 expiry time. */
  readonly expires_at?: string
}

/** Structured user input requested by an employee. */
export interface InputRequestView extends InteractionBase {
  /** Interaction discriminant. */
  readonly kind: 'input'
  /** Admitted input schema identity. */
  readonly input_schema_ref: string
}

/** Enterprise approval requested by the Cloud owner. */
export interface ApprovalRequestView extends InteractionBase {
  /** Interaction discriminant. */
  readonly kind: 'approval'
  /** Owner-supplied risk classification. */
  readonly risk: 'low' | 'medium' | 'high' | 'critical'
  /** Approval authority, distinct from local consent. */
  readonly owner: 'cloud'
}

/** One local resource category requested by a semantic operation. */
export interface ResourceRequirement {
  /** Stable resource slot identity within the request. */
  readonly slot_ref: string
  /** Resource category, never a concrete resource location. */
  readonly resource_kind: 'file' | 'directory' | 'browser_context' | 'clipboard' | 'local_process' | 'mcp_server' | 'device_sensor'
  /** Requested access class. */
  readonly access: 'read' | 'write' | 'execute' | 'observe'
  /** Admitted constraint identity. */
  readonly scope_constraint_ref: string
  /** Exact constraint digest. */
  readonly scope_constraint_hash: string
}

/** Semantic local operation awaiting separate local consent. */
export interface LocalOperationRequestView extends InteractionBase {
  /** Interaction discriminant. */
  readonly kind: 'local_operation'
  /** Device capability selected by policy. */
  readonly capability_ref: string
  /** Semantic operation name, never a command string. */
  readonly operation: string
  /** Admitted argument schema identity. */
  readonly argument_schema_ref: string
  /** Arguments already projected for Renderer display. */
  readonly arguments: JsonValue
  /** Owner-supplied risk classification. */
  readonly risk: 'low' | 'medium' | 'high' | 'critical'
  /** Owner-supplied effect classification. */
  readonly effect_class: 'none' | 'reversible' | 'irreversible' | 'external_side_effect'
  /** Resource categories needed before dispatch. */
  readonly resource_requirements: readonly ResourceRequirement[]
  /** Whether a trusted local surface must capture consent. */
  readonly consent_required: boolean
}

/** User interaction projected for the Renderer. */
export type InteractionRequestView =
  | InputRequestView
  | ApprovalRequestView
  | LocalOperationRequestView

/** Display-safe receipt for an owner or local effect. */
export interface EffectReceiptView {
  /** Stable opaque receipt identity. */
  readonly receipt_ref: ReceiptRef
  /** Opaque subject identity associated with the receipt. */
  readonly subject_ref: string
  /** Owner-observed operation outcome. */
  readonly status: 'accepted' | 'succeeded' | 'failed' | 'rejected' | 'unknown'
  /** Whether the requested effect was observed. */
  readonly effect_state: 'none' | 'not_applied' | 'applied' | 'unknown'
  /** User-visible materials produced by the effect. */
  readonly result_material_refs: readonly MaterialRef[]
  /** Stable display reason when supplied. */
  readonly reason_code?: string
  /** Opaque owner revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 owner record time. */
  readonly recorded_at: string
}

/** Complete detail for one loaded collaboration. */
export interface EngagementSnapshot {
  /** Collaboration header. */
  readonly engagement: EngagementView
  /** Complete loaded activity replacement in display order. */
  readonly activities: readonly ActivityView[]
  /** Complete loaded material replacement in display order. */
  readonly materials: readonly MaterialView[]
  /** Complete loaded interaction replacement in display order. */
  readonly interactions: readonly InteractionRequestView[]
  /** Complete loaded receipt replacement in display order. */
  readonly receipts: readonly EffectReceiptView[]
  /** Whether more history is available through a subsequent service read. */
  readonly has_more: boolean
  /** Opaque owner revision for this complete detail. */
  readonly owner_revision: OwnerRevision
}

/** One complete immutable business projection observed by the Renderer. */
export interface EmployeeExperienceSnapshot {
  /** Top-level recovery and compatibility state. */
  readonly state: 'loading' | 'signed_out' | 'device_registration_required' | 'ready' | 'degraded' | 'update_required'
  /** Current complete employee catalog, absent before a usable baseline. */
  readonly workforce: EmployeeWorkforceView | null
  /** Loaded collaboration summaries in display order. */
  readonly engagements: readonly EngagementView[]
  /** Whether the Host can load additional collaboration summaries. */
  readonly has_more_engagements: boolean
  /** Detail currently loaded by the object layer, independent of view selection. */
  readonly current_engagement: EngagementSnapshot | null
  /** Strictly increasing process-local replacement generation. */
  readonly view_generation: number
  /** UTC RFC 3339 time at which this replacement was committed. */
  readonly observed_at?: string
  /** Display-safe degraded-state cause. */
  readonly error?: ProductError
}

/** Local paging request over the object layer's current projection. */
export interface EngagementPageInput {
  /** Zero-based index in the current complete replacement. */
  readonly offset: number
  /** Bounded number of summaries requested. */
  readonly limit: number
}

/** Local page detached from transport recovery state. */
export interface EngagementPage {
  /** Collaboration summaries in owner-defined order. */
  readonly items: readonly EngagementView[]
  /** Starting index represented by this page. */
  readonly offset: number
  /** Whether another local page is available. */
  readonly has_more: boolean
  /** Owner revision shared by this local projection read. */
  readonly revision: OwnerRevision
}

/** Input for opening a collaboration with one employee. */
export interface OpenEngagementInput {
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
  /** Selected employee. */
  readonly employee_ref: EmployeeRef
  /** Optional user-visible title. */
  readonly title?: string
}

/** One Renderer-provided employee input part. */
export type EmployeeInputPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'cloud_material_ref'; readonly material_ref: MaterialRef }
  | {
      readonly kind: 'local_resource_handle'
      readonly handle_ref: LocalResourceHandleRef
      readonly display_name: string
    }

/** Input for starting one visible employee activity. */
export interface SubmitEmployeeInput {
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
  /** Collaboration receiving the input. */
  readonly engagement_ref: EngagementRef
  /** Ordered user input parts. */
  readonly parts: readonly EmployeeInputPart[]
  /** Owner revision the user acted on. */
  readonly expected_revision: OwnerRevision
}

/** Input for answering one owner interaction exactly once. */
export interface InteractionResponseInput {
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
  /** Interaction being answered. */
  readonly interaction_ref: InteractionRef
  /** One currently allowed owner outcome. */
  readonly outcome_id: string
  /** Optional schema-admitted response values. */
  readonly values?: JsonValue
  /** Optional Host-issued consent identity for a local resource. */
  readonly local_consent_ref?: LocalConsentRef
  /** Owner revision the user acted on. */
  readonly expected_revision: OwnerRevision
}

/** Input for requesting controlled material content. */
export interface MaterialAccessInput {
  /** Stable idempotency identity. */
  readonly operation_id: OperationId
  /** Material selected by the user. */
  readonly material_ref: MaterialRef
  /** Requested user action. */
  readonly action: 'preview' | 'download'
  /** Display-safe purpose for policy evaluation. */
  readonly purpose: string
  /** Owner revision the user acted on. */
  readonly expected_revision: OwnerRevision
}

/** Short-lived controlled access metadata; content travels through a separate handler. */
export interface MaterialAccessGrant {
  /** Stable opaque grant identity. */
  readonly grant_ref: MaterialAccessGrantRef
  /** Material covered by the grant. */
  readonly material_ref: MaterialRef
  /** Permitted action. */
  readonly action: 'preview' | 'download'
  /** Controlled content identity. */
  readonly content_ref: ContentRef
  /** Authoritative content media type. */
  readonly media_type: string
  /** Authoritative complete content size. */
  readonly byte_size: number
  /** Authoritative complete content digest. */
  readonly content_hash: string
  /** Optional display filename, not a local location. */
  readonly display_filename?: string
  /** UTC RFC 3339 grant expiry time. */
  readonly expires_at: string
}

/** Stored outcome of an idempotent operation. */
export interface OperationStatusView {
  /** Original idempotency identity. */
  readonly operation_id: OperationId
  /** Stable product action name. */
  readonly action: string
  /** Optional opaque business subject. */
  readonly subject_ref?: string
  /** Current reconciliation state. */
  readonly state: 'pending' | 'accepted' | 'succeeded' | 'failed' | 'rejected' | 'unknown'
  /** Display receipt when one has been committed. */
  readonly receipt_ref?: ReceiptRef
  /** Typed result or display-safe error when retained by the owner. */
  readonly outcome?:
    | {
        readonly kind: 'result'
        readonly result_contract: ContractRef
        readonly result: JsonValue
        readonly result_hash: string
      }
    | {
        readonly kind: 'error'
        readonly error: ProductError
        readonly error_hash: string
      }
  /** Opaque owner revision. */
  readonly revision: OwnerRevision
  /** UTC RFC 3339 time of the latest owner change. */
  readonly updated_at: string
}

/** One replacement listener; callbacks are synchronous and failures are contained. */
export type EmployeeExperienceListener = (snapshot: EmployeeExperienceSnapshot) => void

/** Atomic initial read and subscription registration. */
export interface EmployeeExperienceObservation {
  /** Immutable snapshot current in the same critical section as registration. */
  readonly snapshot: EmployeeExperienceSnapshot
  /** Idempotent disposer that prevents future replacement delivery. */
  readonly dispose: () => void
}
