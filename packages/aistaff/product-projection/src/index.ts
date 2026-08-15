/**
 * Deterministic in-memory Host projection for the Aistaff UI acceptance fixture.
 * @module @deepseek-ai/dsh-aistaff-product-projection
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import {
  ApprovalId,
  EmployeeId,
  ReceiptId,
  TaskId,
} from '@deepseek-ai/dsh-aistaff-product-contracts'
import type {
  AistaffClientPort,
  Approval,
  ApprovalRespondedEvent,
  CreateTaskInput,
  Employee,
  ProductError,
  ProductProjectionEvent,
  ProductProjectionListener,
  ProductProjectionSnapshot,
  ProductResult,
  Receipt,
  RespondApprovalInput,
  Task,
} from '@deepseek-ai/dsh-aistaff-product-contracts'
import z from '@deepseek-ai/schemastery'

/** Explicit local employee catalog required by the in-memory provider. */
export interface Config {
  /** Non-empty employee catalog recorded when the service loads. */
  readonly employees: readonly Employee[]
  /** Host-owned risk assigned to newly created local tasks. */
  readonly defaultApprovalRisk: Approval['risk']
}

const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  status: z.union(['ready', 'busy', 'offline']),
  capabilities: z.array(z.string().min(1)),
})

interface MutableProjection {
  revision: number
  readonly employees: Map<string, Employee>
  readonly tasks: Map<string, Task>
  readonly approvals: Map<string, Approval>
  readonly receipts: Map<string, Receipt>
}

/** Build an empty mutable accumulator for one replay. */
function emptyProjection(): MutableProjection {
  return {
    revision: 0,
    employees: new Map(),
    tasks: new Map(),
    approvals: new Map(),
    receipts: new Map(),
  }
}

/** Fail a compile when the closed event union gains an unhandled member. */
function assertNever(value: never): never {
  throw new Error(`unsupported Aistaff product event ${JSON.stringify(value)}`)
}

/** Reject a duplicate key while replaying append-only creation facts. */
function requireAbsent<T>(map: ReadonlyMap<string, T>, id: string, kind: string): void {
  if (map.has(id)) throw new Error(`duplicate ${kind} id ${JSON.stringify(id)} in product event stream`)
}

/** Apply one already-sequenced event to a replay accumulator. */
function applyEvent(state: MutableProjection, event: ProductProjectionEvent): void {
  const expectedRevision = state.revision + 1
  if (event.revision !== expectedRevision) {
    throw new Error(`product event revision ${String(event.revision)} must be ${String(expectedRevision)}`)
  }

  switch (event.type) {
    case 'employee.registered': {
      requireAbsent(state.employees, event.employee.id, 'employee')
      state.employees.set(event.employee.id, event.employee)
      break
    }
    case 'task.created': {
      if (!state.employees.has(event.task.employeeId)) {
        throw new Error(`task ${JSON.stringify(event.task.id)} references unknown employee ${JSON.stringify(event.task.employeeId)}`)
      }
      requireAbsent(state.tasks, event.task.id, 'task')
      requireAbsent(state.approvals, event.approval.id, 'approval')
      if (event.approval.taskId !== event.task.id || event.approval.decision !== null
        || event.task.status !== 'needs_approval') {
        throw new Error(`task creation event ${String(event.revision)} does not contain a matching pending approval`)
      }
      state.tasks.set(event.task.id, event.task)
      state.approvals.set(event.approval.id, event.approval)
      break
    }
    case 'approval.responded': {
      const pending = state.approvals.get(event.approval.id)
      const task = state.tasks.get(event.task.id)
      if (pending === undefined || task === undefined || pending.decision !== null
        || pending.taskId !== task.id || event.approval.taskId !== task.id
        || event.receipt.approvalId !== pending.id || event.receipt.taskId !== task.id) {
        throw new Error(`approval response event ${String(event.revision)} does not settle one pending task`)
      }
      const expectedStatus = event.approval.decision === 'approve' ? 'approved' : 'rejected'
      if (event.task.status !== expectedStatus || event.receipt.status !== expectedStatus
        || event.receipt.decision !== event.approval.decision) {
        throw new Error(`approval response event ${String(event.revision)} has inconsistent terminal values`)
      }
      requireAbsent(state.receipts, event.receipt.id, 'receipt')
      state.approvals.set(event.approval.id, event.approval)
      state.tasks.set(event.task.id, event.task)
      state.receipts.set(event.receipt.id, event.receipt)
      break
    }
    default:
      assertNever(event)
  }
  state.revision = event.revision
}

/** Copy a replay accumulator into a caller-owned JSON-compatible snapshot. */
function snapshotOf(state: MutableProjection): ProductProjectionSnapshot {
  return {
    revision: state.revision,
    employees: [...state.employees.values()].map(employee => ({
      ...employee,
      capabilities: [...employee.capabilities],
    })),
    tasks: [...state.tasks.values()].map(task => ({ ...task })),
    approvals: [...state.approvals.values()].map(approval => ({ ...approval })),
    receipts: [...state.receipts.values()].map(receipt => ({ ...receipt })),
  }
}

/**
 * Rebuild the complete product snapshot from an append-only event sequence.
 * @param events - events ordered by contiguous one-based revision.
 * @returns a detached snapshot whose order follows the corresponding creation facts.
 */
export function projectProductEvents(events: readonly ProductProjectionEvent[]): ProductProjectionSnapshot {
  const state = emptyProjection()
  for (const event of events) applyEvent(state, event)
  return snapshotOf(state)
}

/** Build a display-safe failed result. */
function failure(
  code: ProductError['code'],
  message: string,
  retryable = false,
): ProductResult<never> {
  return { ok: false, error: { code, message, retryable } }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local Aistaff Host projection and fixture product operations. */
    aistaffProduct: ProductProjectionService
  }
}

/**
 * In-memory Service Provider for the Aistaff fixture Host port. Every accepted
 * command commits one complete event before notifying subscribers. A later
 * persistence provider can replace this service without changing the Client
 * contract.
 */
export class ProductProjectionService extends Service implements AistaffClientPort {
  /** Loader validation for the explicit local employee catalog. */
  static Config: z<Config> = z.object({
    employees: z.array(employeeSchema).min(1),
    defaultApprovalRisk: z.union(['low', 'medium', 'high']),
  }) as unknown as z<Config>

  private readonly history: ProductProjectionEvent[] = []
  private readonly listeners = new Set<ProductProjectionListener>()
  private current: ProductProjectionSnapshot = projectProductEvents([])

  /**
   * Create the local provider and record its configured employee catalog.
   * @param ctx - Cordis context that owns the service.
   * @param config - explicit, non-empty local employee catalog.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'aistaffProduct')
    if (config.employees.length === 0) {
      throw new Error('aistaff product projection requires at least one configured employee')
    }
    const ids = new Set<string>()
    for (const source of config.employees) {
      if (ids.has(source.id)) {
        throw new Error(`aistaff product projection employee id ${JSON.stringify(source.id)} is duplicated`)
      }
      ids.add(source.id)
      const occurredAt = new Date().toISOString()
      this.commit({
        revision: this.history.length + 1,
        type: 'employee.registered',
        occurredAt,
        employee: {
          ...source,
          id: EmployeeId(source.id),
          capabilities: [...source.capabilities],
        },
      })
    }
  }

  /**
   * Read the complete current projection.
   * @returns a successful result carrying a detached snapshot.
   */
  async getSnapshot(): Promise<ProductResult<ProductProjectionSnapshot>> {
    return { ok: true, value: projectProductEvents(this.history) }
  }

  /**
   * Create one local task and its pending approval atomically.
   * @param input - selected employee and task title. Approval display values are derived by the Host.
   * @returns the created task, or a stable business failure.
   */
  async createTask(input: CreateTaskInput): Promise<ProductResult<Task>> {
    const title = input.title.trim()
    if (title.length === 0) {
      return failure('INVALID_REQUEST', 'Task title must not be blank.')
    }
    const employee = this.current.employees.find(candidate => candidate.id === input.employeeId)
    if (employee === undefined) {
      return failure('NOT_FOUND', `Employee ${JSON.stringify(input.employeeId)} was not found.`)
    }
    if (employee.status !== 'ready') {
      return failure('CONFLICT', `Employee ${JSON.stringify(input.employeeId)} is not ready.`, true)
    }

    const occurredAt = new Date().toISOString()
    const task: Task = {
      id: TaskId(randomUUID()),
      employeeId: input.employeeId,
      title,
      status: 'needs_approval',
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }
    const approval: Approval = {
      id: ApprovalId(randomUUID()),
      taskId: task.id,
      summary: `允许${employee.name}执行任务“${title}”`,
      risk: this.config.defaultApprovalRisk,
      decision: null,
    }
    this.commit({
      revision: this.history.length + 1,
      type: 'task.created',
      occurredAt,
      task,
      approval,
    })
    return { ok: true, value: { ...task } }
  }

  /**
   * Settle one pending approval. The first response commits the approval outcome
   * and receipt; every later response returns `CONFLICT` without another event.
   * @param input - approval identity and terminal decision.
   * @returns the approval receipt, or a stable business failure.
   */
  async respondApproval(input: RespondApprovalInput): Promise<ProductResult<Receipt>> {
    const approval = this.current.approvals.find(candidate => candidate.id === input.approvalId)
    if (approval === undefined) {
      return failure('NOT_FOUND', `Approval ${JSON.stringify(input.approvalId)} was not found.`)
    }
    if (approval.decision !== null) {
      return failure('CONFLICT', `Approval ${JSON.stringify(input.approvalId)} has already been decided.`)
    }
    const task = this.current.tasks.find(candidate => candidate.id === approval.taskId)
    if (task === undefined) {
      throw new Error(`pending approval ${JSON.stringify(approval.id)} has no projected task`)
    }

    const occurredAt = new Date().toISOString()
    const status = input.decision === 'approve' ? 'approved' : 'rejected'
    const decidedApproval: Approval = { ...approval, decision: input.decision }
    const terminalTask: Task = { ...task, status, updatedAt: occurredAt }
    const receipt: Receipt = {
      id: ReceiptId(randomUUID()),
      taskId: task.id,
      approvalId: approval.id,
      decision: input.decision,
      status,
      summary: input.decision === 'approve'
        ? `任务已批准，等待本地执行：${task.title}`
        : `任务已拒绝：${task.title}`,
      recordedAt: occurredAt,
    }
    const event: ApprovalRespondedEvent = {
      revision: this.history.length + 1,
      type: 'approval.responded',
      occurredAt,
      approval: decidedApproval,
      task: terminalTask,
      receipt,
    }
    this.commit(event)
    return { ok: true, value: { ...receipt } }
  }

  /**
   * Subscribe to future committed product facts on the caller's Cordis effect.
   * @param listener - contained synchronous observer.
   * @returns disposer that stops delivery.
   */
  subscribe(listener: ProductProjectionListener): () => void {
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => {
        this.listeners.delete(listener)
      }
    }, 'aistaffProduct.subscribe()')
    return () => void dispose()
  }

  /**
   * Export the process-local event history for replay or a future persistence adapter.
   * @returns a fresh event array in commit order.
   */
  eventHistory(): readonly ProductProjectionEvent[] {
    return [...this.history]
  }

  /** Commit one validated event and publish it after projection state changes. */
  private commit(event: ProductProjectionEvent): void {
    const nextHistory = [...this.history, event]
    const next = projectProductEvents(nextHistory)
    this.history.push(event)
    this.current = next
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event)
      } catch (error) {
        this.ctx.logger.warn('aistaff product projection listener failed')
        this.ctx.logger.warn(error)
      }
    }
  }
}

export default ProductProjectionService
