import { describe, expect, it } from 'vitest'
import { ApprovalId, EmployeeId, ReceiptId, TaskId } from '../src/index.ts'

describe('Aistaff product ids', () => {
  it('remain JSON strings while carrying distinct compile-time brands', () => {
    const value = {
      employee: EmployeeId('employee-1'),
      task: TaskId('task-1'),
      approval: ApprovalId('approval-1'),
      receipt: ReceiptId('receipt-1'),
    }

    expect(JSON.parse(JSON.stringify(value))).toEqual({
      employee: 'employee-1',
      task: 'task-1',
      approval: 'approval-1',
      receipt: 'receipt-1',
    })
  })
})
