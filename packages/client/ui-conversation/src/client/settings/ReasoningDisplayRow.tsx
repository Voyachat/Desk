/** General Settings row for the chat view's inline-reasoning preference. */
import { useState } from 'react'
import type { SnapshotStore } from '@voyaseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './ReasoningDisplayRow.module.css'

/** Registration-side preference face. */
export interface ReasoningDisplayRowInjected {
  hooks: {
    /** Persisted inline-reasoning preference bound as useShowReasoning. */
    showReasoning: SnapshotStore<boolean>
  }
  /** Change the inline-reasoning preference. */
  setShowReasoning: (show: boolean) => void
}

/** Full Settings-row props. */
export type ReasoningDisplayRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ReasoningDisplayRowInjected>

const OPTIONS: readonly {
  id: 'inline' | 'folded'
  label: ConversationKey
}[] = [
  { id: 'inline', label: 'settings.reasoning.inline' },
  { id: 'folded', label: 'settings.reasoning.folded' },
]

/**
 * Render the inline-reasoning display selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ReasoningDisplayRow({ useShowReasoning, setShowReasoning, t }: ReasoningDisplayRowProps) {
  const showReasoning = useShowReasoning(value => value)
  const [open, setOpen] = useState(false)
  const selectedLabel = showReasoning ? 'settings.reasoning.inline' : 'settings.reasoning.folded'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.reasoning.title')}</div>
        <div className={css.desc}>{t('settings.reasoning.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={showReasoning ? 'inline' : 'folded'}
        onSelect={(id) => {
          setOpen(false)
          setShowReasoning(id === 'inline')
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
