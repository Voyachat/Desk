import type { ReactNode } from 'react'
import type { AppState } from '../../domain/client-state.ts'
import { Icon, type IconName } from '../../ui/Icon.tsx'
import css from './SettingsDialog.module.css'

const SECTIONS: readonly [AppState['settingsSection'], string, IconName][] = [
  ['general', 'General', 'tune'],
  ['models', 'Models', 'spark'],
  ['plugins', 'Plugins', 'folder'],
  ['presets', 'Agent presets', 'robot'],
]

export function SettingsDialog({ section, onSection, onClose, onReset }: { section: AppState['settingsSection']; onSection(section: AppState['settingsSection']): void; onClose(): void; onReset(): void }) {
  return (
    <div className={css.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label="设置">
        <header><b>设置</b><button type="button" aria-label="关闭设置" onClick={onClose}><Icon name="close" /></button></header>
        <div className={css.layout}>
          <nav>
            {SECTIONS.map(([id, label, icon]) => <button type="button" key={id} data-active={id === section || undefined} onClick={() => { onSection(id) }}><Icon name={icon} size={15} />{label}</button>)}
          </nav>
          <div className={css.content}>
            {section === 'general' && <General onReset={onReset} />}
            {section === 'models' && <Models />}
            {section === 'plugins' && <Plugins />}
            {section === 'presets' && <Presets />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return <div className={css.row}><span><b>{title}</b><small>{description}</small></span>{control}</div>
}
function General({ onReset }: { onReset(): void }) {
  return <><h2>General</h2><p className={css.lead}>客户端外观与本地交互偏好</p><section><h3>Appearance</h3><Row title="Theme" description="跟随系统外观" control={<button type="button" className={css.select}>System <Icon name="chevron" size={12} /></button>} /><Row title="Language" description="界面显示语言" control={<button type="button" className={css.select}>简体中文 <Icon name="chevron" size={12} /></button>} /></section><section><h3>Demo data</h3><Row title="重置前端演示" description="恢复会话、授权和任务的初始状态" control={<button type="button" className={css.danger} onClick={onReset}>重置</button>} /></section></>
}
function Models() { return <><h2>Models</h2><p className={css.lead}>模型配置由正式 Client 的 credentials 与 settings 插件提供</p><section><h3>Available</h3>{['DeepSeek-V4-Flash', 'DeepSeek-V4', 'DeepSeek-V3.2'].map((model, index) => <Row key={model} title={model} description={index === 0 ? '默认 · 已就绪' : '可选模型'} control={<span className={css.status}>{index === 0 ? 'Default' : 'Ready'}</span>} />)}</section></> }
function Plugins() { return <><h2>Plugins</h2><p className={css.lead}>产品能力以独立 Client 插件装配到 DSAgent slot</p><section><h3>Client extensions</h3><Row title="AI Employee" description="任务投影、状态与任务收件箱" control={<span className={css.status}>Enabled</span>} /><Row title="Approval Receipt" description="授权回执与本地审计展示" control={<span className={css.status}>Enabled</span>} /></section></> }
function Presets() { return <><h2>Agent presets</h2><p className={css.lead}>新会话使用的 Agent 组合</p><section><h3>Presets</h3>{['标准模式', 'PTC 模式', '最小模式', '客户运营员工'].map((preset, index) => <Row key={preset} title={preset} description={index === 3 ? 'AiDesktop 产品插件提供' : 'DSAgent 基础预设'} control={<button type="button" className={css.more}><Icon name="more" /></button>} />)}</section></> }
