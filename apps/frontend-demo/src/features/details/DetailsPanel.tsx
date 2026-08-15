import { useState } from 'react'
import type { ToolDetails } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './DetailsPanel.module.css'

type Tab = 'summary' | 'options' | 'usage' | 'timing'

export function DetailsPanel({ details, onClose }: { details: ToolDetails; onClose(): void }) {
  const [tab, setTab] = useState<Tab>('summary')
  return (
    <div className={css.root}>
      <header><div><span>Tool call</span><b>{details.title}</b></div><button type="button" aria-label="关闭详情" onClick={onClose}><Icon name="close" /></button></header>
      <div className={css.tabs} role="tablist">
        {([['summary', 'Summary'], ['options', 'Options'], ['usage', 'Usage'], ['timing', 'Timing']] as const).map(([id, label]) => <button type="button" key={id} role="tab" aria-selected={tab === id} data-active={tab === id || undefined} onClick={() => { setTab(id) }}>{label}</button>)}
      </div>
      <div className={css.body}>
        {tab === 'summary' && <><section><h3>概述</h3><p>{details.summary}</p></section><section><h3>Input</h3><pre>{details.input}</pre></section><section><h3>Output</h3><pre>{details.output}</pre></section></>}
        {tab === 'options' && <><section><h3>执行位置</h3><dl><dt>Workspace</dt><dd>AiDesktop</dd><dt>Permission</dt><dd>Workspace Write</dd><dt>Source</dt><dd>Client projection</dd></dl></section></>}
        {tab === 'usage' && <section><h3>资源占用</h3><dl><dt>Events</dt><dd>3</dd><dt>Payload</dt><dd>1.4 KB</dd><dt>Context</dt><dd>0.3%</dd></dl></section>}
        {tab === 'timing' && <section><h3>执行时间</h3><dl><dt>Duration</dt><dd>{details.duration}</dd><dt>Queue</dt><dd>18 ms</dd><dt>Recorded</dt><dd>本地</dd></dl></section>}
      </div>
      <footer>前端投影视图 · 正式版本从 session log 重建</footer>
    </div>
  )
}
