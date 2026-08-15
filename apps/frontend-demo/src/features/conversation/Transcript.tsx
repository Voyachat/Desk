import type { SessionSummary, ToolDetails, TranscriptItem } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './Transcript.module.css'

function Item({ item, onOpenDetails }: { item: TranscriptItem; onOpenDetails(details: ToolDetails): void }) {
  if (item.kind === 'user') return (
    <div className={css.userWrap}>
      <div className={css.userBubble}>{item.body}</div>
      <button type="button" className={css.copy} aria-label="复制消息"><Icon name="copy" size={14} /></button>
    </div>
  )
  if (item.kind === 'assistant') return <div className={css.assistant}>{item.body}</div>
  if (item.kind === 'context') return (
    <div className={css.context}><Icon name="file" size={14} /><span>{item.body}</span>{item.meta && <small>· {item.meta}</small>}</div>
  )
  if (item.kind === 'tool') return (
    <button type="button" className={css.tool} data-tone={item.tone} onClick={() => { if (item.details !== undefined) onOpenDetails(item.details) }}>
      <span className={css.toolIcon}><Icon name={item.tone === 'warn' ? 'warning' : 'file'} size={14} /></span>
      <span className={css.toolBody}><b>{item.label}</b><span>{item.body}</span></span>
      <small>{item.meta}</small><Icon name="chevron" size={13} className={css.rowChevron} />
    </button>
  )
  if (item.kind === 'receipt') return (
    <button type="button" className={css.receipt} data-tone={item.tone} onClick={() => { if (item.details !== undefined) onOpenDetails(item.details) }}>
      <span className={css.receiptIcon}><Icon name={item.tone === 'success' ? 'check' : 'warning'} size={14} /></span>
      <span><b>{item.label}</b>{item.body}</span><small>{item.meta}</small>
    </button>
  )
  return <div className={css.status}>{item.body}<span>{item.meta}</span></div>
}

export function Transcript({ session, onOpenDetails }: { session: SessionSummary; onOpenDetails(details: ToolDetails): void }) {
  return (
    <div className={css.flow}>
      {session.employeeRun !== undefined && (
        <div className={css.employeeRun}>
          <div className={css.employeeTop}>
            <span className={css.avatar}><Icon name="spark" size={16} /></span>
            <div><b>{session.employeeRun.employeeName}</b><small>{session.employeeRun.employeeRole}</small></div>
            <span className={css.runPill} data-status={session.employeeRun.status}>{session.employeeRun.status === 'waiting-approval' ? '等待授权' : session.employeeRun.status === 'completed' ? '已完成' : session.employeeRun.status === 'rejected' ? '已拒绝' : '运行中'}</span>
          </div>
          <div className={css.progress}><i style={{ width: `${session.employeeRun.progress}%` }} /></div>
          <div className={css.progressMeta}><span>{session.employeeRun.runLabel}</span><b>{session.employeeRun.progress}%</b></div>
        </div>
      )}
      {session.items.map(entry => <Item key={entry.id} item={entry} onOpenDetails={onOpenDetails} />)}
    </div>
  )
}
