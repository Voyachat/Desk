import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type {
  ChatConversationViewNode, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import { shallowEqual } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  WORKFLOW_STATUS_KEYS, workflowDotState, type WorkflowRunInjected,
} from './WorkflowRunPanel.tsx'
import type {
  WorkflowRunChatData, WorkflowRunMemberData, WorkflowRunPhaseData,
} from './workflow-definition.ts'
import css from './WorkflowDashboardAction.module.css'

type WorkflowNode = ChatConversationViewNode & {
  readonly kind: 'workflow-run'
  readonly data: WorkflowRunChatData
}

/** Full props for the current-session Workflow dashboard trigger. */
export type WorkflowDashboardActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'workflowRun'>
  & Pick<WorkflowRunInjected, 'retryRun'>

function workflowNodes(snapshot: ConversationSnapshot): readonly WorkflowNode[] {
  const runs: WorkflowNode[] = []
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node?.kind === 'workflow-run') runs.push(node as WorkflowNode)
  }
  return runs
}

function countLabel(count: number, t: WorkflowDashboardActionProps['t']): string {
  return t(count === 1 ? 'dashboard.trigger.one' : 'dashboard.trigger.other', { count })
}

function stepsLabel(count: number, t: WorkflowDashboardActionProps['t']): string {
  return t(count === 1 ? 'dashboard.steps.one' : 'dashboard.steps.other', { count })
}

function phaseLabel(phase: WorkflowRunPhaseData, t: WorkflowDashboardActionProps['t']): string {
  if (phase.phase === null) return t('phase.unassigned')
  return phase.phase === '' ? t('phase.empty') : phase.phase
}

function memberLabel(member: WorkflowRunMemberData, t: WorkflowDashboardActionProps['t']): string {
  return member.label === '' ? t('member.empty') : member.label
}

/** Header action aggregating every Workflow run in the current loaded Session window. */
export function WorkflowDashboardAction({ useSession, retryRun, t }: WorkflowDashboardActionProps) {
  const runs = useSession(workflowNodes, shallowEqual)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => { document.removeEventListener('pointerdown', closeOutside) }
  }, [open])

  useEffect(() => {
    if (runs.length === 0 && open) setOpen(false)
  }, [open, runs.length])

  if (runs.length === 0) return null

  const active = runs.some(run => run.data.status === 'pending' || run.data.status === 'running')
  const recoverable = runs.some(run => run.data.resumable)
  const label = countLabel(runs.length, t)
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    setOpen(false)
    triggerRef.current?.focus()
  }
  const restart = (run: WorkflowNode): void => {
    if (retrying !== null) return
    if (confirming !== run.id) {
      setConfirming(run.id)
      setFailed(null)
      return
    }
    setConfirming(null)
    setRetrying(run.id)
    setFailed(null)
    void retryRun(run.id).then(
      () => { setRetrying(null) },
      () => {
        setRetrying(null)
        setFailed(run.id)
      },
    )
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-expanded={open}
        aria-label={label}
        onClick={() => { setOpen(value => !value) }}
      >
        {active || recoverable
          ? <StateDot state={active ? 'ongoing' : 'warning'} className={css.triggerDot} />
          : null}
        <span className={css.count}>{label}</span>
        <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
      </button>
      {open
        ? (
          <div className={css.menu} role="dialog" aria-label={t('dashboard.aria')}>
            {runs.map((run) => {
              const stepCount = run.data.phases.reduce((count, phase) => count + phase.members.length, 0)
              const isExpanded = expanded === run.id
              const retryLabel = retrying === run.id
                ? t('action.running')
                : confirming === run.id
                  ? t('action.confirm')
                  : run.data.status === 'interrupted' ? t('action.resume') : t('action.retry')
              return (
                <section key={run.key} className={css.run} data-dashboard-run-status={run.data.status}>
                  <button
                    type="button"
                    className={css.runSummary}
                    aria-expanded={isExpanded}
                    onClick={() => { setExpanded(value => value === run.id ? null : run.id) }}
                  >
                    <StateDot state={workflowDotState(run.data.status)} />
                    <span className={css.runName}>{run.data.name}</span>
                    <span className={css.stepCount}>{stepsLabel(stepCount, t)}</span>
                    <span className={css.status}>{t(WORKFLOW_STATUS_KEYS[run.data.status])}</span>
                    <span className={css.inspect}>{t('dashboard.inspect')}</span>
                  </button>
                  {isExpanded
                    ? (
                      <div className={css.details}>
                        {run.data.phases.length === 0
                          ? <span className={css.empty}>{t('run.empty')}</span>
                          : run.data.phases.map(phase => (
                            <div key={phase.key} className={css.phase}>
                              <span className={css.phaseName}>{phaseLabel(phase, t)}</span>
                              {phase.members.map(member => (
                                <div key={member.seq} className={css.member} data-member-status={member.status}>
                                  <StateDot state={workflowDotState(member.status)} />
                                  <span className={css.memberName}>{memberLabel(member, t)}</span>
                                  <span className={css.memberStatus}>{t(WORKFLOW_STATUS_KEYS[member.status])}</span>
                                </div>
                              ))}
                            </div>
                          ))}
                        {run.data.resumable
                          ? (
                            <div className={css.recovery}>
                              <span>{t('recovery.resumable')}</span>
                              <button
                                type="button"
                                className={css.retry}
                                disabled={retrying !== null}
                                onClick={() => { restart(run) }}
                              >
                                {retryLabel}
                              </button>
                              {failed === run.id ? <span className={css.error}>{t('action.retryFailed')}</span> : null}
                            </div>
                          )
                          : null}
                      </div>
                    )
                    : null}
                </section>
              )
            })}
          </div>
        )
        : null}
    </div>
  )
}
