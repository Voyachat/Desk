// One collapsed turn-activity disclosure: consecutive internal-execution
// Nodes (tool calls, thinking, mid-turn narration of closed turns) fold into
// this single summary row. Expanding renders the original Node seats in
// place under the summary line; the fold itself carries no anchor key, so
// paging anchors always resolve to a member seat.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import a11yCss from './accessibility.module.css'
import css from './ActivityFold.module.css'

export interface ActivityFoldProps {
  /** Member flow keys rendered as ordinary seats while expanded. */
  readonly members: readonly string[]
  /** True while any member is still running. */
  readonly running: boolean
  /** Root tool calls in the fold, for the step-count figure. */
  readonly toolCalls: number
  /** Earliest member start time (epoch ms); null drops the duration figure. */
  readonly startTime: number | null
  /** Latest member end time (epoch ms); null while the fold still runs. */
  readonly endTime: number | null
  /** Render one member key through the standard node seat. */
  readonly renderMember: (key: string) => ReactNode
  /** The owning view's locale seat. */
  readonly t: ChatViewSlotProps['t']
}

/**
 * Render one activity fold row over its member seats.
 * @param props - fold membership, summary figures, and the seat renderer.
 * @returns the disclosure row, collapsed by default.
 */
export function ActivityFold({
  members, running, toolCalls, startTime, endTime, renderMember, t,
}: ActivityFoldProps) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(id) }
  }, [running])
  const elapsedMs = running
    ? startTime !== null ? Math.max(0, now - startTime) : null
    : startTime !== null && endTime !== null ? Math.max(0, endTime - startTime) : null
  const parts: string[] = []
  if (elapsedMs !== null && elapsedMs >= 1000) parts.push(formatRunDuration(elapsedMs, t))
  if (toolCalls > 0) parts.push(t('activity.steps', { steps: toolCalls }))
  return (
    <div className={css.root} data-activity-fold="" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={running ? t('activity.running') : t('activity.done')}
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={parts.length > 0 && (
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary}>{parts.join(' · ')}</span>
          </>
        )}
      >
        <div className={css.body}>{members.map(renderMember)}</div>
      </DisclosureRow>
    </div>
  )
}
