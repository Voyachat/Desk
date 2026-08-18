/** Private wire and state types for the test-only Client Gateway fixture. */

import type {
  ActivityView,
  EffectReceiptView,
  EmployeeWorkforceView,
  EngagementSnapshot,
  EngagementView,
  InteractionRequestView,
  MaterialAccessGrant,
  MaterialView,
  OperationStatusView,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type {
  InteractionRef,
  MaterialRef,
  OperationId,
  OwnerRevision,
} from '@voyaseek-ai/dsh-aistaff-employee-experience/types'

/** Explicit deterministic business scenario; approval remains the default. */
export type ConformanceScenario = 'approval' | 'local_read'

/** Fixed provenance proving this artifact is never a production contract source. */
export interface ConformanceArtifactProvenance {
  readonly test_only: true
  readonly artifact_version: string
  readonly root_hash: string
  readonly source: 'AiDesktop local Client Gateway conformance fixture'
}

/** Selected-response envelope used only by the local conformance transport. */
export interface FixtureEnvelope<T> {
  readonly contract: 'aistaff.client-gateway-envelope.fixture@1.0'
  readonly contract_selection_ref: string
  readonly data: T
}

/** Version-independent bootstrap error used by the fixture. */
export interface FixtureBootstrapError {
  readonly error: {
    readonly code: 'UPDATE_REQUIRED'
    readonly retryable: false
  }
}

/** Selected Gateway error used only by the local conformance transport. */
export interface FixtureErrorEnvelope {
  readonly contract_selection_ref: string
  readonly error: {
    readonly code:
      | 'INVALID_REQUEST'
      | 'NOT_FOUND'
      | 'REVISION_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'EXPIRED'
      | 'CURSOR_EXPIRED'
      | 'UNKNOWN_OUTCOME'
    readonly retryable: boolean
    readonly operation_id?: string
  }
}

/** Snapshot lease retained by the in-memory fixture. */
export interface FixtureSnapshotLease {
  readonly snapshot_ref: string
  readonly stream_ref: string
  readonly resume_cursor: string
}

/** Immutable baseline captured when a fixture lease is created. */
export interface FixtureBaseline {
  readonly workforce: EmployeeWorkforceView
  readonly engagements: readonly EngagementView[]
  readonly details: readonly EngagementSnapshot[]
}

/** Known fixture event payloads. */
export type FixtureEventPayload =
  | { readonly type: 'engagement.changed'; readonly value: EngagementView }
  | { readonly type: 'activity.changed'; readonly value: ActivityView }
  | { readonly type: 'material.changed'; readonly value: MaterialView }
  | { readonly type: 'interaction.changed'; readonly value: InteractionRequestView }
  | { readonly type: 'receipt.changed'; readonly value: EffectReceiptView }
  | { readonly type: 'fixture.unknown'; readonly value: { readonly marker: string } }

/** Raw forward-open fixture event envelope. */
export interface FixtureEventEnvelope {
  readonly envelope_contract: 'aistaff.employee-event-envelope.fixture@1.0'
  readonly payload_contract: string
  readonly contract_selection_ref: string
  readonly stream_ref: string
  readonly event_ref: string
  readonly cursor: string
  readonly payload_type: string
  readonly ignorable: boolean
  readonly occurred_at: string
  readonly payload: FixtureEventPayload
}

/** Stored idempotent mutation response and fingerprint. */
export interface FixtureOperationRecord {
  readonly fingerprint: string
  readonly status: number
  readonly value: EngagementView | ActivityView | EffectReceiptView | MaterialAccessGrant
  readonly outcome: OperationStatusView
}

/** Path-free bounded local result admitted by the authoritative fixture owner. */
export type ConformanceLocalResultPayload =
  | {
      readonly kind: 'directory'
      readonly entries: readonly {
        readonly name: string
        readonly kind: 'file' | 'directory'
        readonly size_bytes?: number
      }[]
    }
  | {
      readonly kind: 'file'
      readonly text: string
      readonly media_type: string
    }

/** Idempotent Host-only publication command for one bounded local result. */
export interface ConformanceLocalResultInput {
  /** Original idempotent Local Capability operation. */
  readonly operation_id: OperationId
  /** Current authoritative local-operation interaction. */
  readonly interaction_ref: InteractionRef
  /** Exact interaction revision resolved before Supervisor dispatch. */
  readonly interaction_revision: OwnerRevision
  /** Bounded path-free result to publish as one canonical Material. */
  readonly payload: ConformanceLocalResultPayload
}

/** Canonical Cloud owner result returned to the Local Capability sink. */
export interface ConformanceLocalResultPublication {
  /** Canonical Material identities committed by the Cloud owner. */
  readonly material_refs: readonly MaterialRef[]
  /** Cloud projection Receipt committed with the Material. */
  readonly receipt: EffectReceiptView
}

/** Retained idempotent local result publication. */
export interface FixtureLocalResultRecord {
  /** Exact publication input fingerprint. */
  readonly fingerprint: string
  /** Retained canonical publication result. */
  readonly publication: ConformanceLocalResultPublication
}

/** Mutable business state behind the fixture Gateway. */
export interface FixtureBusinessState {
  workforce: EmployeeWorkforceView
  engagements: EngagementView[]
  details: Map<string, EngagementSnapshot>
  materials: Map<string, MaterialView>
  interactions: Map<string, InteractionRequestView>
  operations: Map<string, FixtureOperationRecord>
  /** Host-only local result publication records. */
  localResultPublications: Map<string, FixtureLocalResultRecord>
}
