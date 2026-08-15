/**
 * JSON-compatible Aistaff product values shared by the Host and Renderer.
 * @module @deepseek-ai/dsh-aistaff-product-contracts/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies an AI employee in the product projection. */
export type EmployeeId = Branded<'AistaffEmployeeId'>

/** Identifies a local product task. */
export type TaskId = Branded<'AistaffTaskId'>

/** Identifies a user approval request. */
export type ApprovalId = Branded<'AistaffApprovalId'>

/** Identifies the terminal receipt for an approval response. */
export type ReceiptId = Branded<'AistaffReceiptId'>

/** Availability displayed for one employee. */
export type EmployeeStatus = 'ready' | 'busy' | 'offline'

/** Complete task lifecycle exposed by the deterministic UI fixture. */
export type TaskStatus = 'needs_approval' | 'approved' | 'rejected'

/** Risk label displayed before an approval decision. */
export type ApprovalRisk = 'low' | 'medium' | 'high'

/** The only decisions accepted by a pending fixture approval. */
export type ApprovalDecision = 'approve' | 'reject'

/** A projected AI employee. */
export interface Employee {
  /** Stable employee identity. */
  readonly id: EmployeeId
  /** Human-readable employee name. */
  readonly name: string
  /** Human-readable responsibility. */
  readonly role: string
  /** Current projected availability. */
  readonly status: EmployeeStatus
  /** Product capability identifiers advertised by the employee. */
  readonly capabilities: readonly string[]
}

/** A projected local task. */
export interface Task {
  /** Stable task identity. */
  readonly id: TaskId
  /** Employee selected for the task. */
  readonly employeeId: EmployeeId
  /** User-visible task title. */
  readonly title: string
  /** Current fixture lifecycle state. */
  readonly status: TaskStatus
  /** UTC RFC 3339 creation time. */
  readonly createdAt: string
  /** UTC RFC 3339 time of the latest committed change. */
  readonly updatedAt: string
}

/** A projected approval request and its optional terminal decision. */
export interface Approval {
  /** Stable approval identity. */
  readonly id: ApprovalId
  /** Task whose continuation the user decides. */
  readonly taskId: TaskId
  /** User-visible explanation of the requested action. */
  readonly summary: string
  /** Product risk label. */
  readonly risk: ApprovalRisk
  /** `null` until the first committed response. */
  readonly decision: ApprovalDecision | null
}

/** Terminal, display-safe outcome of one approval response. */
export interface Receipt {
  /** Stable receipt identity. */
  readonly id: ReceiptId
  /** Task settled by this receipt. */
  readonly taskId: TaskId
  /** Approval settled by this receipt. */
  readonly approvalId: ApprovalId
  /** Decision that produced the receipt. */
  readonly decision: ApprovalDecision
  /** Outcome of the approval step; `approved` still awaits an execution provider. */
  readonly status: 'approved' | 'rejected'
  /** User-visible result summary. */
  readonly summary: string
  /** UTC RFC 3339 commit time. */
  readonly recordedAt: string
}

/** Input for creating one local task and its approval request. */
export interface CreateTaskInput {
  /** Employee selected by the user. */
  readonly employeeId: EmployeeId
  /** Non-blank task title. */
  readonly title: string
}

/** Input for settling one pending approval. */
export interface RespondApprovalInput {
  /** Approval selected by the user. */
  readonly approvalId: ApprovalId
  /** The only supported terminal decisions. */
  readonly decision: ApprovalDecision
}

/** Stable business error returned across the Renderer-to-Host port. */
export interface ProductError {
  /** Machine-readable failure class. */
  readonly code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT'
  /** Display-safe error text without internal paths or stack data. */
  readonly message: string
  /** Whether retrying the same request can succeed without another state change. */
  readonly retryable: boolean
}

/** Result envelope used by every fixture product operation. */
export type ProductResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProductError }

/** One consistent read of the complete local product projection. */
export interface ProductProjectionSnapshot {
  /** Last applied event sequence, or zero for an empty stream. */
  readonly revision: number
  /** Employees in registration order. */
  readonly employees: readonly Employee[]
  /** Tasks in creation order. */
  readonly tasks: readonly Task[]
  /** Approvals in creation order. */
  readonly approvals: readonly Approval[]
  /** Receipts in commit order. */
  readonly receipts: readonly Receipt[]
}

/** Employee catalog fact recorded by the local provider. */
export interface EmployeeRegisteredEvent {
  /** Monotonic one-based sequence. */
  readonly revision: number
  /** Event discriminant. */
  readonly type: 'employee.registered'
  /** UTC RFC 3339 commit time. */
  readonly occurredAt: string
  /** Complete employee value. */
  readonly employee: Employee
}

/** Atomic task and approval creation fact. */
export interface TaskCreatedEvent {
  /** Monotonic one-based sequence. */
  readonly revision: number
  /** Event discriminant. */
  readonly type: 'task.created'
  /** UTC RFC 3339 commit time. */
  readonly occurredAt: string
  /** Complete created task. */
  readonly task: Task
  /** Complete pending approval created with the task. */
  readonly approval: Approval
}

/** Atomic approval, task, and receipt settlement fact. */
export interface ApprovalRespondedEvent {
  /** Monotonic one-based sequence. */
  readonly revision: number
  /** Event discriminant. */
  readonly type: 'approval.responded'
  /** UTC RFC 3339 commit time. */
  readonly occurredAt: string
  /** Complete decided approval. */
  readonly approval: Approval
  /** Complete task after the approval decision. */
  readonly task: Task
  /** Complete terminal receipt. */
  readonly receipt: Receipt
}

/** Append-only fixture product event vocabulary. */
export type ProductProjectionEvent =
  | EmployeeRegisteredEvent
  | TaskCreatedEvent
  | ApprovalRespondedEvent

/** Listener for committed local product facts. */
export type ProductProjectionListener = (event: ProductProjectionEvent) => void

/** Renderer-facing Host operations used by the UI acceptance fixture. */
export interface AistaffClientPort {
  /** Read a complete baseline before consuming subscription events. */
  getSnapshot(): Promise<ProductResult<ProductProjectionSnapshot>>
  /** Create one task and its pending approval. */
  createTask(input: CreateTaskInput): Promise<ProductResult<Task>>
  /** Settle one pending approval exactly once. */
  respondApproval(input: RespondApprovalInput): Promise<ProductResult<Receipt>>
  /** Subscribe to committed facts; the disposer stops delivery. */
  subscribe(listener: ProductProjectionListener): () => void
}
