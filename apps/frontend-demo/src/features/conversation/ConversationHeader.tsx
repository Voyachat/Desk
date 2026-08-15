import type { SessionSummary, ViewId } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './ConversationHeader.module.css'

export function ConversationHeader({ session, view, onSelectView }: { session: SessionSummary; view: ViewId; onSelectView(view: ViewId): void }) {
  return (
    <header className={css.header}>
      <div className={css.titleRow}>
        <div className={css.titleCluster}>
          <strong>{session.title}</strong>
          <span className={css.preset}><Icon name={session.kind === 'employee' ? 'robot' : 'spark'} size={13} />{session.preset}</span>
          {session.employeeRun !== undefined && (
            <span className={css.runStatus} data-status={session.employeeRun.status}>
              <i />{session.employeeRun.runLabel}
            </span>
          )}
        </div>
        <button type="button" className={css.logButton}><span>Session log</span><Icon name="download" size={14} /></button>
      </div>
      <div className={css.tabs} role="tablist">
        <button type="button" role="tab" aria-selected={view === 'chat'} data-active={view === 'chat' || undefined} onClick={() => { onSelectView('chat') }}>对话</button>
        <button type="button" role="tab" aria-selected={view === 'trajectory'} data-active={view === 'trajectory' || undefined} onClick={() => { onSelectView('trajectory') }}>轨迹</button>
      </div>
    </header>
  )
}
