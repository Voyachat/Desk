import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { createAistaffProductStore } from './store.ts'
import css from './AistaffProduct.module.css'

/** Complete props for the additive sidebar footer action. */
export type AistaffFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createAistaffProductStore>>

/** Render the wide-row or compact-rail AI employee entry. */
export function AistaffFooterAction({ wide, useStore, actions }: AistaffFooterActionProps) {
  const open = useStore(state => state.open)
  return (
    <button
      type="button"
      className={css.entry}
      aria-label="打开 AI 员工工作台"
      aria-haspopup="dialog"
      aria-expanded={open}
      title={wide ? undefined : 'AI 员工'}
      data-wide={wide || undefined}
      onClick={actions.openWorkbench}
    >
      <span className={css.entryMark} aria-hidden>AI</span>
      {wide && <span className={css.entryLabel}>AI 员工</span>}
    </button>
  )
}
