/** Host-only DTOs for the AiDesktop Supervisor control plane. @module @deepseek-ai/dsh-aistaff-supervisor-control/types */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one idempotent Supervisor mutation or read. */
export type SupervisorOperationId = Branded<'AistaffSupervisorOperationId'>

/** Identifies the current Host session's capability-only execution context. */
export type CapabilityContextHandle = Branded<'AistaffCapabilityContextHandle'>

/** Identifies one Supervisor-managed runtime without exposing its endpoint. */
export type SupervisorRuntimeHandle = Branded<'AistaffSupervisorRuntimeHandle'>

/** Identifies one local resource Grant. */
export type SupervisorGrantHandle = Branded<'AistaffSupervisorGrantHandle'>

/** Identifies one immutable revision of a local resource Grant. */
export type SupervisorGrantRevision = Branded<'AistaffSupervisorGrantRevision'>

/** Identifies one Supervisor Receipt. */
export type SupervisorReceiptRef = Branded<'AistaffSupervisorReceiptRef'>

/** Identifies one path-free root identity fingerprint. */
export type SupervisorRootFingerprint = Branded<'AistaffSupervisorRootFingerprint'>

/** Identifies one path-free piece of execution evidence. */
export type SupervisorEvidenceRef = Branded<'AistaffSupervisorEvidenceRef'>

/** Identifies a local AI employee activity. */
export type SupervisorActivityRef = Branded<'AistaffSupervisorActivityRef'>

/** Identifies a DSH Session without exposing its persistence representation. */
export type SupervisorDshSessionId = Branded<'AistaffSupervisorDshSessionId'>

/** Identifies a managed Tenant. */
export type SupervisorTenantId = Branded<'AistaffSupervisorTenantId'>

/** Identifies a managed device session. */
export type SupervisorDeviceSessionId = Branded<'AistaffSupervisorDeviceSessionId'>

/** Identifies a managed Cloud run. */
export type SupervisorRunId = Branded<'AistaffSupervisorRunId'>

/** Identifies a managed Cloud step. */
export type SupervisorStepId = Branded<'AistaffSupervisorStepId'>

/** Stable protocol version owned by AiDesktop. */
export type SupervisorControlVersion = 'aidesktop.supervisor-control.v1'

/** Current Supervisor process facts and Host-session capability context. */
export interface SupervisorHello {
  /** Selected control protocol version. */
  readonly control_version: SupervisorControlVersion
  /** Supervisor implementation version. */
  readonly supervisor_version: string
  /** Control versions the process can serve. */
  readonly supported_control_versions: readonly string[]
  /** Host operating-system identifier. */
  readonly platform: string
  /** Host architecture identifier. */
  readonly architecture: string
  /** Semantic local capabilities available in this process. */
  readonly capabilities: readonly string[]
  /** Maximum accepted request bytes. */
  readonly max_request_bytes: number
  /** Maximum returned result bytes. */
  readonly max_result_bytes: number
  /** Opaque capability-only context issued for the current Host session. */
  readonly capability_context_handle: CapabilityContextHandle
}

/** Subject to which a local Grant and execution are bound. */
export type SupervisorSubjectBinding =
  | {
      /** Local, non-Cloud subject. */
      readonly kind: 'local'
      /** Local activity identity. */
      readonly activity_ref: SupervisorActivityRef
      /** DSH Session receiving any model-visible result. */
      readonly dsh_session_id: SupervisorDshSessionId
    }
  | {
      /** Managed Cloud subject. */
      readonly kind: 'managed'
      /** Verified Tenant identity. */
      readonly tenant_id: SupervisorTenantId
      /** Verified device-session identity. */
      readonly device_session_id: SupervisorDeviceSessionId
      /** Verified Cloud run identity. */
      readonly run_id: SupervisorRunId
      /** Verified Cloud step identity. */
      readonly step_id: SupervisorStepId
      /** Positive attempt number selected by Cloud. */
      readonly attempt: number
      /** DSH Session receiving any model-visible result. */
      readonly dsh_session_id: SupervisorDshSessionId
    }

/** Privileged Host request to register one user-selected root. */
export interface SupervisorGrantRegister {
  /** Idempotency identity for this registration. */
  readonly operation_id: SupervisorOperationId
  /** Exact local or verified managed subject. */
  readonly subject: SupervisorSubjectBinding
  /** Absolute root path admitted only on this privileged Host hop. */
  readonly root_path: string
  /** Path-free label safe for Renderer display. */
  readonly display_name: string
  /** V2 access class. */
  readonly access: 'read_only'
  /** Semantic read intents allowed under the Grant. */
  readonly allowed_intents: readonly string[]
  /** UTC RFC 3339 expiry. */
  readonly expires_at: string
}

/** Path-free projection of one local resource Grant. */
export interface SupervisorGrant {
  /** Opaque Grant identity. */
  readonly grant_handle: SupervisorGrantHandle
  /** Current immutable Grant revision. */
  readonly grant_revision: SupervisorGrantRevision
  /** Path-free label safe for display. */
  readonly display_name: string
  /** Granted access class. */
  readonly access: 'read_only'
  /** Semantic intents admitted by the Grant. */
  readonly allowed_intents: readonly string[]
  /** UTC RFC 3339 expiry. */
  readonly expires_at: string
  /** Path-free identity of the selected root. */
  readonly root_fingerprint: SupervisorRootFingerprint
}

/** Receipt emitted for a committed Supervisor outcome. */
export interface SupervisorReceipt {
  /** Opaque Receipt identity. */
  readonly receipt_ref: SupervisorReceiptRef
  /** Original idempotent operation. */
  readonly operation_id: SupervisorOperationId
  /** Observed operation outcome. */
  readonly status: 'succeeded' | 'failed' | 'rejected' | 'unknown'
  /** Observed local effect state. */
  readonly effect_state: 'none' | 'not_applied' | 'applied' | 'unknown'
  /** Stable path-free failure reason. */
  readonly reason_code?: string
  /** Opaque path-free evidence identities. */
  readonly evidence_refs: readonly SupervisorEvidenceRef[]
  /** Integrity identity over the Receipt fields. */
  readonly receipt_hash: string
  /** UTC RFC 3339 commit time. */
  readonly recorded_at: string
}

/** Result of registering one local resource Grant. */
export interface SupervisorGrantResult {
  /** Registered path-free Grant projection. */
  readonly grant: SupervisorGrant
  /** Registration Receipt. */
  readonly receipt: SupervisorReceipt
}

/** Idempotent request to revoke one exact Grant revision. */
export interface SupervisorGrantRevoke {
  /** Idempotency identity for this revocation. */
  readonly operation_id: SupervisorOperationId
  /** Grant being revoked. */
  readonly grant_handle: SupervisorGrantHandle
  /** Revision the caller observed. */
  readonly expected_grant_revision: SupervisorGrantRevision
}

/** Execution context selected for one local capability read. */
export type SupervisorExecutionContext =
  | {
      /** Cloud Runtime remains remote and the current Host context executes only a capability. */
      readonly kind: 'capability_only'
      /** Current Host-session capability context from {@link SupervisorHello}. */
      readonly capability_context_handle: CapabilityContextHandle
    }
  | {
      /** A previously admitted managed runtime owns the execution. */
      readonly kind: 'managed_runtime'
      /** Opaque managed runtime identity. */
      readonly runtime_handle: SupervisorRuntimeHandle
    }

/** Request for one bounded read under an active Grant. */
export interface ReadCapabilityRequest {
  /** Idempotency identity for this read. */
  readonly operation_id: SupervisorOperationId
  /** Capability-only or managed-runtime execution context. */
  readonly execution_context: SupervisorExecutionContext
  /** Subject that must exactly match the Grant. */
  readonly subject: SupervisorSubjectBinding
  /** Grant authorizing the resource root. */
  readonly grant_handle: SupervisorGrantHandle
  /** Exact active Grant revision. */
  readonly expected_grant_revision: SupervisorGrantRevision
  /** Semantic intent admitted by the Grant and capability table. */
  readonly intent: string
  /** Relative path segments interpreted only by Supervisor. */
  readonly relative_segments: readonly string[]
  /** Maximum complete result bytes accepted by the caller. */
  readonly max_bytes: number
  /** UTC RFC 3339 deadline checked before any read. */
  readonly deadline_at: string
}

/** Path-free bounded result of one local read. */
export type ReadCapabilityPayload =
  | {
      /** Regular-file content. */
      readonly kind: 'file'
      /** Complete bounded file bytes. */
      readonly bytes: Uint8Array
      /** Admitted media type. */
      readonly media_type: string
    }
  | {
      /** One bounded directory listing. */
      readonly kind: 'directory'
      /** Direct path-free child entries. */
      readonly entries: readonly {
        /** Child basename only. */
        readonly name: string
        /** Child kind. */
        readonly kind: 'file' | 'directory'
        /** File size when available. */
        readonly size_bytes?: number
      }[]
    }
  | {
      /** Metadata-only response. */
      readonly kind: 'metadata'
      /** Resolved target kind. */
      readonly target_kind: 'file' | 'directory'
      /** File size when available. */
      readonly size_bytes?: number
    }

/** Result of one committed bounded local read. */
export interface ReadCapabilityResult {
  /** Bounded path-free payload. */
  readonly payload: ReadCapabilityPayload
  /** Read Receipt. */
  readonly receipt: SupervisorReceipt
}

/** Retained status of one idempotent Supervisor operation. */
export interface SupervisorOperationStatus {
  /** Original operation identity. */
  readonly operation_id: SupervisorOperationId
  /** Reconciliation state. */
  readonly state: 'succeeded' | 'failed' | 'rejected' | 'unknown'
  /** Receipt retained for a committed or uncertain outcome. */
  readonly receipt_ref?: SupervisorReceiptRef
  /** UTC RFC 3339 time of the latest status change. */
  readonly updated_at: string
}

/** Stable fail-closed Supervisor control error codes. */
export type SupervisorControlErrorCode =
  | 'SUPERVISOR_UNAVAILABLE'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'GRANT_NOT_ACTIVE'
  | 'GRANT_REVISION_MISMATCH'
  | 'GRANT_SCOPE_MISMATCH'
  | 'CAPABILITY_DENIED'
  | 'TARGET_IDENTITY_CHANGED'
  | 'DEADLINE_EXPIRED'
  | 'OUTCOME_UNKNOWN'
  | 'INVALID_REQUEST'
  | 'OPERATION_CONFLICT'
  | 'NOT_FOUND'
