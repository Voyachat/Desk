import type { AppState, ClientCommand } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import { ComposerBar } from './ComposerBar.tsx'
import css from './NewSessionHero.module.css'

const PRESETS = [
  ['标准模式', '完整工具与通用推理'],
  ['PTC 模式', '代码驱动的复杂任务'],
  ['最小模式', '精简上下文与工具'],
  ['创作模式', '内容策划与表达'],
] as const

export function NewSessionHero({ state, dispatch }: { state: AppState; dispatch(command: ClientCommand): void }) {
  const workspace = state.workspaces.find(candidate => candidate.id === state.selectedWorkspaceId)
  return (
    <div className={css.hero}>
      <div className={css.glow} />
      <div className={css.title}><Icon name="spark" size={24} /><h1>探索未至之境</h1></div>
      <p>从一个本地会话开始，或选择 AI 员工接管持续任务</p>
      <div className={css.chips}>
        <div className={css.chipRoot} data-menu-root>
          <button type="button" className={css.chip} onClick={() => { dispatch({ type: 'menu.toggle', menu: 'workspace' }) }}>
            <Icon name="folder" size={14} /><span>{workspace?.title ?? '选择工作区'}</span><Icon name="chevron" size={12} />
          </button>
          {state.menu === 'workspace' && (
            <div className={css.picker}>
              <div className={css.pickerLabel}>工作区</div>
              {state.workspaces.map(item => (
                <button type="button" key={item.id} data-selected={item.id === state.selectedWorkspaceId || undefined} onClick={() => { dispatch({ type: 'workspace.select', workspaceId: item.id }) }}>
                  <Icon name="folder" size={15} /><span><b>{item.title}</b><small>{item.path}</small></span>{item.id === state.selectedWorkspaceId && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={css.chipRoot} data-menu-root>
          <button type="button" className={css.chip} onClick={() => { dispatch({ type: 'menu.toggle', menu: 'preset' }) }}>
            <Icon name="spark" size={14} /><span>{state.stagedPreset}</span><Icon name="chevron" size={12} />
          </button>
          {state.menu === 'preset' && (
            <div className={css.picker}>
              <div className={css.pickerLabel}>Agent preset</div>
              {PRESETS.map(([title, description]) => (
                <button type="button" key={title} data-selected={title === state.stagedPreset || undefined} onClick={() => { dispatch({ type: 'preset.select', preset: title }) }}>
                  <Icon name={title === '创作模式' ? 'spark' : 'robot'} size={15} /><span><b>{title}</b><small>{description}</small></span>{title === state.stagedPreset && <Icon name="check" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={css.composer}>
        <ComposerBar state={state} variant="hero" dispatch={dispatch} />
      </div>
      <div className={css.hint}><span>Enter 发送</span><i /> <span>Shift + Enter 换行</span></div>
    </div>
  )
}
