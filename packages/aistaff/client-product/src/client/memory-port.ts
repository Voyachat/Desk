import type {
  AistaffClientPort,
  Approval,
  CreateTaskInput,
  Employee,
  ProductProjectionEvent,
  ProductProjectionSnapshot,
  ProductError,
  ProductResult,
  Receipt,
  RespondApprovalInput,
  Task,
} from '@voyaseek-ai/dsh-aistaff-product-contracts'

const ISO_BASE = Date.parse('2026-01-01T00:00:00.000Z')

function success<T>(value: T): ProductResult<T> {
  return { ok: true, value }
}

function failure<T>(code: ProductError['code'], message: string): ProductResult<T> {
  return { ok: false, error: { code, message, retryable: false } }
}

function employee(id: string, name: string, role: string, status: Employee['status']): Employee {
  return {
    id: id as Employee['id'],
    name,
    role,
    status,
    capabilities: ['资料整理', '本地任务执行'],
  }
}

/**
 * Create the deterministic projection used by the local UI fixture Port.
 * @returns a fresh initial projection for one isolated Fixture instance.
 */
export function createMemoryProjection(): ProductProjectionSnapshot {
  const employees = [
    employee('employee-research', '研究助理', '资料研究与摘要', 'ready'),
    employee('employee-ops', '运营助理', '任务跟进与整理', 'ready'),
  ]
  const task: Task = {
    id: 'task-welcome' as Task['id'],
    employeeId: employees[0]!.id,
    title: '整理本周重点事项',
    status: 'needs_approval',
    createdAt: new Date(ISO_BASE).toISOString(),
    updatedAt: new Date(ISO_BASE).toISOString(),
  }
  const approval: Approval = {
    id: 'approval-welcome' as Approval['id'],
    taskId: task.id,
    summary: '允许研究助理整理本周重点事项',
    risk: 'low',
    decision: null,
  }
  return { revision: 1, employees, tasks: [task], approvals: [approval], receipts: [] }
}

/**
 * Create a deterministic in-memory implementation of the replaceable client Port.
 * @param initial - Initial projection copied into the Port.
 * @returns The in-memory Port.
 */
export function createMemoryAistaffClientPort(
  initial: ProductProjectionSnapshot = createMemoryProjection(),
): AistaffClientPort {
  let snapshot: ProductProjectionSnapshot = {
    ...initial,
    employees: [...initial.employees],
    tasks: [...initial.tasks],
    approvals: [...initial.approvals],
    receipts: [...initial.receipts],
  }
  let sequence = snapshot.tasks.length + 1
  const listeners = new Set<(event: ProductProjectionEvent) => void>()

  const publish = (event: ProductProjectionEvent): void => {
    for (const listener of listeners) listener(event)
  }

  return {
    getSnapshot: async () => success(snapshot),
    createTask: async (input: CreateTaskInput) => {
      const title = input.title.trim()
      const selected = snapshot.employees.find(value => value.id === input.employeeId)
      if (selected === undefined) {
        return failure<Task>('NOT_FOUND', '所选 AI 员工不存在')
      }
      if (title === '') return failure<Task>('INVALID_REQUEST', '任务标题不能为空')
      const suffix = sequence++
      const now = new Date(ISO_BASE + suffix * 1_000).toISOString()
      const task: Task = {
        id: `task-${suffix}` as Task['id'],
        employeeId: input.employeeId,
        title,
        status: 'needs_approval',
        createdAt: now,
        updatedAt: now,
      }
      const approval: Approval = {
        id: `approval-${suffix}` as Approval['id'],
        taskId: task.id,
        summary: `允许${selected.name}执行任务“${title}”`,
        risk: 'medium',
        decision: null,
      }
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        tasks: [...snapshot.tasks, task],
        approvals: [...snapshot.approvals, approval],
      }
      publish({
        revision: snapshot.revision,
        type: 'task.created',
        occurredAt: now,
        task,
        approval,
      })
      return success(task)
    },
    respondApproval: async (input: RespondApprovalInput) => {
      const approval = snapshot.approvals.find(value => value.id === input.approvalId)
      if (approval === undefined) return failure<Receipt>('NOT_FOUND', '待审批项不存在')
      if (approval.decision !== null) return failure<Receipt>('CONFLICT', '该审批已经处理')
      const task = snapshot.tasks.find(value => value.id === approval.taskId)
      if (task === undefined) return failure<Receipt>('NOT_FOUND', '审批关联的任务不存在')
      const suffix = sequence++
      const now = new Date(ISO_BASE + suffix * 1_000).toISOString()
      const terminalStatus = input.decision === 'approve' ? 'approved' : 'rejected'
      const receipt: Receipt = {
        id: `receipt-${suffix}` as Receipt['id'],
        taskId: task.id,
        approvalId: approval.id,
        decision: input.decision,
        status: terminalStatus,
        summary: input.decision === 'approve' ? '任务已批准，等待本地执行' : '任务已拒绝',
        recordedAt: now,
      }
      const decidedApproval: Approval = { ...approval, decision: input.decision }
      const terminalTask: Task = { ...task, status: terminalStatus, updatedAt: now }
      snapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        tasks: snapshot.tasks.map(value => value.id === task.id ? terminalTask : value),
        approvals: snapshot.approvals.map(value => value.id === approval.id
          ? decidedApproval
          : value),
        receipts: [...snapshot.receipts, receipt],
      }
      publish({
        revision: snapshot.revision,
        type: 'approval.responded',
        occurredAt: now,
        approval: decidedApproval,
        task: terminalTask,
        receipt,
      })
      return success(receipt)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
