import { useRef } from 'react'
import type { AppState, ClientCommand, PermissionMode } from '../../domain/client-state.ts'
import { Icon } from '../../ui/Icon.tsx'
import css from './ComposerBar.module.css'

const PERMISSIONS: readonly { id: PermissionMode; title: string; description: string }[] = [
  { id: 'read-only', title: 'Read Only', description: '仅查看工作区内容' },
  { id: 'workspace-write', title: 'Workspace Write', description: '可修改当前工作区' },
  { id: 'full-access', title: 'Full access', description: '允许访问工作区外资源' },
]
const MODELS = [
  ['DeepSeek-V4-Flash', 'High'],
  ['DeepSeek-V4', 'Medium'],
  ['DeepSeek-V3.2', 'Low'],
] as const

function permissionLabel(mode: PermissionMode): string {
  return PERMISSIONS.find(permission => permission.id === mode)?.title ?? mode
}

export function ComposerBar({ state, variant, dispatch }: { state: AppState; variant: 'hero' | 'composer'; dispatch(command: ClientCommand): void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = (): void => {
    if (state.composer.draft.trim() === '') return
    dispatch({ type: 'composer.submit' })
    requestAnimationFrame(() => { ref.current?.focus() })
  }
  return (
    <div className={css.root} data-variant={variant}>
      <div className={css.card}>
        <textarea
          ref={ref}
          aria-label="给智能体发消息"
          placeholder={variant === 'hero' ? '描述你希望完成的任务' : '给智能体发消息'}
          value={state.composer.draft}
          onChange={(event) => { dispatch({ type: 'composer.draft', draft: event.currentTarget.value }) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
          }}
        />
        <div className={css.toolbar}>
          <div className={css.leftTools}>
            <button type="button" className={css.roundButton} aria-label="添加附件"><Icon name="plus" size={17} /></button>
            <div className={css.menuRoot} data-menu-root>
              <button type="button" className={css.textButton} onClick={() => { dispatch({ type: 'menu.toggle', menu: 'permission' }) }}><Icon name="file" size={14} /><span>{permissionLabel(state.composer.permission)}</span><Icon name="chevron" size={12} /></button>
              {state.menu === 'permission' && (
                <div className={css.menu}>
                  <div className={css.menuTitle}>访问模式</div>
                  {PERMISSIONS.map(permission => (
                    <button type="button" key={permission.id} data-selected={permission.id === state.composer.permission || undefined} onClick={() => { dispatch({ type: 'composer.permission', permission: permission.id }) }}>
                      <span className={css.menuIcon}><Icon name={permission.id === 'read-only' ? 'file' : permission.id === 'workspace-write' ? 'folder' : 'warning'} size={14} /></span>
                      <span><b>{permission.title}</b><small>{permission.description}</small></span>
                      {permission.id === state.composer.permission && <Icon name="check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className={css.rightTools}>
            <div className={css.menuRoot} data-menu-root>
              <button type="button" className={css.textButton} onClick={() => { dispatch({ type: 'menu.toggle', menu: 'model' }) }}><span>{state.composer.model}</span><em>{state.composer.reasoning}</em><Icon name="chevron" size={12} /></button>
              {state.menu === 'model' && (
                <div className={`${css.menu} ${css.modelMenu}`}>
                  <div className={css.menuTitle}>模型与推理强度</div>
                  {MODELS.map(([model, reasoning]) => (
                    <button type="button" key={model} data-selected={model === state.composer.model || undefined} onClick={() => { dispatch({ type: 'composer.model', model, reasoning }) }}>
                      <span className={css.menuIcon}><Icon name="spark" size={14} /></span><span><b>{model}</b><small>Reasoning · {reasoning}</small></span>{model === state.composer.model && <Icon name="check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className={css.contextDot} title="上下文占用 18%"><i /></span>
            <button type="button" className={css.send} aria-label="发送" disabled={state.composer.draft.trim() === ''} onClick={submit}><Icon name="send" size={17} /></button>
          </div>
        </div>
      </div>
      {variant === 'composer' && <div className={css.footer}>5 轮 · 8 步 <span>·</span> 上下文 18%</div>}
    </div>
  )
}
