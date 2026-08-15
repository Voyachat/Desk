import { useState } from 'react'
import type { PendingApproval } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './ApprovalComposer.module.css'

export function ApprovalComposer({ approval, onAnswer }: { approval: PendingApproval; onAnswer(outcome: 'allowed-once' | 'rejected'): void }) {
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    if (answered) return
    setAnswered(true)
    onAnswer(outcome)
  }
  return (
    <div className={css.root} data-approval-key={approval.key}>
      <div className={css.card}>
        <div className={css.strip}><span /><Icon name="warning" size={13} />等待授权</div>
        <div className={css.body} tabIndex={0} role="group" aria-label="授权详情">
          <div className={css.headline}>{approval.reason}</div>
          <div className={css.toolName}>{approval.toolName}</div>
          <code>{approval.command}</code>
          <p>仅对这一次动作生效；正式 Client 的最终裁决与回执由本地 Host 保存。</p>
        </div>
        <div className={css.actions}>
          <button type="button" disabled={answered} onClick={() => { answer('rejected') }}>拒绝</button>
          <button type="button" className={css.allow} disabled={answered} onClick={() => { answer('allowed-once') }}>允许一次</button>
        </div>
      </div>
    </div>
  )
}
