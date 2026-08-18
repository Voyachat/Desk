import type {
  Approval,
  CreateTaskInput,
  Employee,
  RespondApprovalInput,
  Task,
} from '@voyaseek-ai/dsh-aistaff-product-contracts'
import { useEffect, type FormEvent } from 'react'
import type { PropsRuntime, PropsStore } from '@voyaseek-ai/dsh-client-ui-slots'
import type {} from '@voyaseek-ai/dsh-client-ui-layout/client'
import type { createAistaffProductStore } from './store.ts'
import css from './AistaffProduct.module.css'

/** Plain callbacks supplied by the plugin's Port adapter. */
export interface AistaffWorkbenchInjected {
  refreshProjection: () => Promise<boolean>
  createTask: (input: CreateTaskInput) => Promise<boolean>
  respondApproval: (input: RespondApprovalInput) => Promise<boolean>
}

/** Complete props for the additive shell workbench. */
export type AistaffWorkbenchProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createAistaffProductStore>>
  & AistaffWorkbenchInjected

function employeeStatus(status: Employee['status']): string {
  switch (status) {
    case 'ready': return '可用'
    case 'busy': return '忙碌'
    case 'offline': return '离线'
  }
}

function taskStatus(status: Task['status']): string {
  switch (status) {
    case 'needs_approval': return '等待审批'
    case 'approved': return '已批准'
    case 'rejected': return '已拒绝'
  }
}

function riskLabel(risk: Approval['risk']): string {
  switch (risk) {
    case 'low': return '低风险'
    case 'medium': return '中风险'
    case 'high': return '高风险'
  }
}

/** Render employee selection, task creation, approvals, statuses, and receipts. */
export function AistaffWorkbench({
  useStore,
  actions,
  refreshProjection,
  createTask,
  respondApproval,
}: AistaffWorkbenchProps) {
  const state = useStore(value => value)
  useEffect(() => {
    if (state.open && state.projection.revision === 0 && !state.busy) {
      void refreshProjection()
    }
  }, [refreshProjection, state.busy, state.open, state.projection.revision])

  if (!state.open) return null

  const selected = state.projection.employees.find(value => value.id === state.selectedEmployeeId)
  const pendingApprovals = state.projection.approvals.filter(value => value.decision === null)
  const tasks = [...state.projection.tasks].reverse()
  const receipts = [...state.projection.receipts].reverse()

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = state.draftTitle.trim()
    if (selected === undefined || title === '' || state.busy) return
    void createTask({
      employeeId: selected.id,
      title,
    })
  }

  return (
    <aside className={css.workbench} role="dialog" aria-modal="false" aria-labelledby="aistaff-workbench-title">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>本地工作台</p>
          <h2 id="aistaff-workbench-title" className={css.title}>AI 员工</h2>
        </div>
        <button type="button" className={css.close} aria-label="关闭 AI 员工工作台" onClick={actions.closeWorkbench}>×</button>
      </header>

      <section className={css.section} aria-labelledby="aistaff-create-title">
        <h3 id="aistaff-create-title" className={css.sectionTitle}>创建任务</h3>
        <form className={css.form} onSubmit={submit}>
          <label className={css.field}>
            <span>选择员工</span>
            <select
              value={state.selectedEmployeeId ?? ''}
              disabled={state.busy || state.projection.employees.length === 0}
              onChange={event => { actions.selectEmployee(event.currentTarget.value as Employee['id']) }}
            >
              {state.projection.employees.map(value => (
                <option key={value.id} value={value.id} disabled={value.status !== 'ready'}>
                  {value.name} · {employeeStatus(value.status)}
                </option>
              ))}
            </select>
          </label>
          {selected !== undefined && <p className={css.employeeRole}>{selected.role}</p>}
          <label className={css.field}>
            <span>任务标题</span>
            <input
              value={state.draftTitle}
              disabled={state.busy}
              placeholder="例如：整理本周客户反馈"
              onChange={event => { actions.setDraftTitle(event.currentTarget.value) }}
            />
          </label>
          <button
            type="submit"
            className={css.primary}
            disabled={state.busy || selected?.status !== 'ready' || state.draftTitle.trim() === ''}
          >
            {state.busy ? '提交中…' : '创建任务'}
          </button>
        </form>
        {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}
      </section>

      <section className={css.section} aria-labelledby="aistaff-approval-title">
        <div className={css.sectionHeading}>
          <h3 id="aistaff-approval-title" className={css.sectionTitle}>待审批</h3>
          <span className={css.count}>{pendingApprovals.length}</span>
        </div>
        {pendingApprovals.length === 0 && <p className={css.empty}>当前没有待审批任务</p>}
        <div className={css.stack}>
          {pendingApprovals.map(approval => (
            <article key={approval.id} className={css.card}>
              <div className={css.cardHeading}>
                <strong>{approval.summary}</strong>
                <span className={css.risk} data-risk={approval.risk}>{riskLabel(approval.risk)}</span>
              </div>
              <div className={css.approvalActions}>
                <button
                  type="button"
                  className={css.secondary}
                  disabled={state.busy}
                  onClick={() => { void respondApproval({ approvalId: approval.id, decision: 'reject' }) }}
                >拒绝</button>
                <button
                  type="button"
                  className={css.primary}
                  disabled={state.busy}
                  onClick={() => { void respondApproval({ approvalId: approval.id, decision: 'approve' }) }}
                >批准</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={css.section} aria-labelledby="aistaff-task-title">
        <h3 id="aistaff-task-title" className={css.sectionTitle}>任务状态</h3>
        <div className={css.stack}>
          {tasks.map(task => {
            const owner = state.projection.employees.find(value => value.id === task.employeeId)
            return (
              <article key={task.id} className={css.taskRow}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{owner?.name ?? '未知员工'}</p>
                </div>
                <span className={css.status} data-status={task.status}>{taskStatus(task.status)}</span>
              </article>
            )
          })}
        </div>
      </section>

      <section className={css.section} aria-labelledby="aistaff-receipt-title">
        <h3 id="aistaff-receipt-title" className={css.sectionTitle}>回执</h3>
        {receipts.length === 0 && <p className={css.empty}>处理审批后，回执会显示在这里</p>}
        <div className={css.stack}>
          {receipts.map(receipt => (
            <article key={receipt.id} className={css.receipt} data-status={receipt.status}>
              <strong>{receipt.status === 'approved' ? '已批准' : '已拒绝'}</strong>
              <span>{receipt.summary}</span>
            </article>
          ))}
        </div>
      </section>
    </aside>
  )
}
