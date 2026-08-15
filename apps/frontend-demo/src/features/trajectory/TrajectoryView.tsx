import { useMemo, useState } from 'react'
import type { SessionSummary, ToolDetails } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './TrajectoryView.module.css'

interface Row { lane: 'Input' | 'Model' | 'Tools'; title: string; detail: string; duration: string; details?: ToolDetails }

export function TrajectoryView({ session, onOpenDetails }: { session: SessionSummary; onOpenDetails(details: ToolDetails): void }) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const rows = useMemo<readonly Row[]>(() => {
    const result: Row[] = []
    for (const item of session.items) {
      if (item.kind === 'user' || item.kind === 'context') result.push({ lane: 'Input', title: item.kind === 'user' ? 'User message' : 'Context injection', detail: item.body, duration: '—' })
      if (item.kind === 'assistant') result.push({ lane: 'Model', title: session.preset, detail: item.body, duration: '2.1s' })
      if (item.kind === 'tool' || item.kind === 'receipt') result.push({ lane: 'Tools', title: item.label ?? item.kind, detail: item.body, duration: item.details?.duration ?? '—', details: item.details })
    }
    return result.filter(row => `${row.lane} ${row.title} ${row.detail}`.toLowerCase().includes(search.toLowerCase()))
  }, [search, session])
  return (
    <div className={css.root}>
      <div className={css.toolbar} role="toolbar" aria-label="轨迹工具栏">
        <button type="button"><Icon name="clock" size={13} />Duration</button>
        <button type="button" onClick={() => { setCollapsed(value => !value) }}>{collapsed ? '⊞' : '⊟'} Turns</button>
        <button type="button">⊟ Calls</button>
        <label><Icon name="search" size={12} /><input type="search" aria-label="搜索轨迹" placeholder="搜索轨迹" value={search} onChange={(event) => { setSearch(event.currentTarget.value) }} /></label>
      </div>
      <div className={css.timeline}>
        <div className={css.timelineLabel}><b>Turn 1</b><span>{session.kind === 'employee' ? 'AI employee run' : 'Local session'}</span></div>
        <div className={css.timelineTracks}><i className={css.inputTrack} /><i className={css.modelTrack} /><i className={css.toolTrack} /></div>
        <div className={css.timelineTime}>0s <span>1s</span><span>2s</span><span>3s</span></div>
      </div>
      {!collapsed && (
        <div className={css.ledger}>
          <div className={css.headerRow}><span>Lane</span><span>Event</span><span>Detail</span><span>Duration</span></div>
          {rows.map((row, index) => (
            <button type="button" key={`${row.title}-${index}`} className={css.row} disabled={row.details === undefined} onClick={() => { if (row.details !== undefined) onOpenDetails(row.details) }}>
              <span className={css.lane} data-lane={row.lane}>{row.lane}</span><b>{row.title}</b><span>{row.detail}</span><small>{row.duration}</small>
            </button>
          ))}
          {rows.length === 0 && <div className={css.empty}>没有匹配的轨迹事件</div>}
        </div>
      )}
    </div>
  )
}
