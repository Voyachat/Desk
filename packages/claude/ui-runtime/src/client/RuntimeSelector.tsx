/**
 * The composer runtime-selector chip: labels the agent driver the current
 * session runs under (Native = DSH loop, Claude = Claude Agent SDK) and
 * switches by connecting the session workspace under the chosen runtime —
 * a session never changes its own runtime, so the switch lands on a session
 * minted under the pick (a matching blank one is reused) and opens it.
 */

import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, IconCodeOutline16, IconSparkle16, Menu } from '@voyaseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat and
// its InputZone owner share).
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
import type { RuntimeSelectorInjected } from './index.ts'
import css from './RuntimeSelector.module.css'

/** The runtime id the default DSH loop driver is known by in this surface. */
const NATIVE_RUNTIME = ''
/** The runtime id the Claude Agent SDK driver registers under. */
const CLAUDE_RUNTIME = 'claude'

/** Full component props: runtime share (owner zone + standard kit), injected face, locale seat. */
export type RuntimeSelectorProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<RuntimeSelectorInjected> & PropsLocale<'claudeRuntime'>

/**
 * Render the runtime chip for the current session.
 * @param props - composed slot props.
 * @returns the chip with its two-mode menu.
 */
export function RuntimeSelector({ select, useRuntimeSelector, t }: RuntimeSelectorProps) {
  const state = useRuntimeSelector(snapshot => snapshot)
  const [open, setOpen] = useState(false)

  const isClaude = state.current === CLAUDE_RUNTIME
  const label = isClaude ? t('option.claude') : t('option.native')
  const Icon = isClaude ? IconSparkle16 : IconCodeOutline16

  return (
    <span className={css.wrap}>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={[
          {
            id: NATIVE_RUNTIME,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{t('option.native')}</span>
                <span className={css.itemDesc}>{t('option.native.desc')}</span>
              </span>
            ),
          },
          {
            id: CLAUDE_RUNTIME,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{t('option.claude')}</span>
                <span className={css.itemDesc}>{t('option.claude.desc')}</span>
              </span>
            ),
          },
        ]}
        selectedId={state.current}
        onSelect={(id) => {
          setOpen(false)
          if (id !== state.current) select(id)
        }}
        align="start"
        portal
        anchor={(
          <button
            type="button"
            className={css.chip}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={t('chip.aria')}
            title={state.error ?? t('chip.title')}
            disabled={state.busy}
            onClick={() => { setOpen(value => !value) }}
          >
            <Icon className={css.icon} />
            {state.busy ? t('chip.busy') : label}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {state.error !== null && !state.busy && <span className={css.error} role="status">{state.error}</span>}
    </span>
  )
}
