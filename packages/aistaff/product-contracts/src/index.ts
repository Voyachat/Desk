/**
 * Renderer-safe Aistaff product DTOs, branded ids, and Host port types.
 * @module @voyaseek-ai/dsh-aistaff-product-contracts
 */

import type { ApprovalId, EmployeeId, ReceiptId, TaskId } from './types.ts'

export type * from './types.ts'

/**
 * Brand a raw employee id without changing its JSON representation.
 * @param id - opaque employee id string.
 * @returns the same string with the employee-id brand.
 */
export function EmployeeId(id: string): EmployeeId {
  return id as EmployeeId
}

/**
 * Brand a raw task id without changing its JSON representation.
 * @param id - opaque task id string.
 * @returns the same string with the task-id brand.
 */
export function TaskId(id: string): TaskId {
  return id as TaskId
}

/**
 * Brand a raw approval id without changing its JSON representation.
 * @param id - opaque approval id string.
 * @returns the same string with the approval-id brand.
 */
export function ApprovalId(id: string): ApprovalId {
  return id as ApprovalId
}

/**
 * Brand a raw receipt id without changing its JSON representation.
 * @param id - opaque receipt id string.
 * @returns the same string with the receipt-id brand.
 */
export function ReceiptId(id: string): ReceiptId {
  return id as ReceiptId
}
