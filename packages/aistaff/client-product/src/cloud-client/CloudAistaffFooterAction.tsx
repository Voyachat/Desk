import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from '../client/AistaffProduct.module.css'
import type { createCloudProductStore } from './store.ts'

/** Complete props for the Cloud AI employee sidebar action. */
export type CloudAistaffFooterActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsStore<ReturnType<typeof createCloudProductStore>>

/** Render the unchanged wide-row or compact-rail AI employee entry. */
export function CloudAistaffFooterAction({ wide, useStore, actions }: CloudAistaffFooterActionProps) {
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
