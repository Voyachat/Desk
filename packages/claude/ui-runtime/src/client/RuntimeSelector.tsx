/**
 * The composer runtime-selector chip: labels the agent driver the current
 * session runs under (Native = DSH loop, Claude = Claude Agent SDK, Codex =
 * OpenAI Codex) and
 * switches by connecting a matching blank session or forking retained
 * conversation history under the chosen runtime. The source session stays
 * unchanged.
 */

import { useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutline16,
  IconChevronDownOutline14,
  IconCodeOutline16,
  IconSparkle16,
  Menu,
  Toast,
} from '@voyaseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat and
// its InputZone owner share).
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
import type { RuntimeSelectorInjected } from './index.ts'
import css from './RuntimeSelector.module.css'

/** The runtime id the default DSH loop driver is known by in this surface. */
const NATIVE_RUNTIME = ''
/** The runtime id the Claude Agent SDK driver registers under. */
const CLAUDE_RUNTIME = 'claude'
/** The runtime id the OpenAI Codex driver registers under. */
const CODEX_RUNTIME = 'codex'

/** Full component props: runtime share (owner zone + standard kit), injected face, locale seat. */
export type RuntimeSelectorProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<RuntimeSelectorInjected> & PropsLocale<'claudeRuntime'>

/**
 * Render the runtime chip for the current session.
 * @param props - composed slot props.
 * @returns the chip with its three-mode menu.
 */
export function RuntimeSelector({ dismissWarning, select, useRuntimeSelector, t }: RuntimeSelectorProps) {
  const state = useRuntimeSelector(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  const runtime = state.current === CLAUDE_RUNTIME
    ? { label: t('option.claude'), Icon: IconSparkle16 }
    : state.current === CODEX_RUNTIME
      ? { label: t('option.codex'), Icon: IconAgentPresetOutline16 }
      : { label: t('option.native'), Icon: IconCodeOutline16 }
  const { label, Icon } = runtime

  return (
    <span ref={rootRef} className={css.wrap}>
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
          {
            id: CODEX_RUNTIME,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{t('option.codex')}</span>
                <span className={css.itemDesc}>{t('option.codex.desc')}</span>
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
            title={state.error ?? (state.running ? t('chip.running') : t('chip.title'))}
            disabled={state.busy || state.running}
            onClick={() => { setOpen(value => !value) }}
          >
            <Icon className={css.icon} />
            {state.busy ? t('chip.busy') : label}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
      {state.error !== null && !state.busy && <span className={css.error} role="status">{state.error}</span>}
      {state.warningSeq !== null && (
        <Toast
          key={state.warningSeq}
          text={t('switch.warning')}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={dismissWarning}
        />
      )}
    </span>
  )
}
