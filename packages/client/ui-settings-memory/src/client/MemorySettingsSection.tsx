/** Long-term memory page, independent of the settings shell layout. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, RiskConfirmation } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@voyaseek-ai/dsh-client-web-react'
import type { PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import type { MemorySettingsKey } from './locales.ts'
import type { MemoryEntryView, MemorySettingsState, MemorySettingsStore } from './store.ts'
import { MemoryEditorAction } from './MemoryEditor.tsx'
import css from './MemorySettingsSection.module.css'

/** Data and actions injected by the page registration. */
export interface MemorySettingsSectionInjected {
  controller: MemorySettingsStore
  useSnapshot: SnapshotSelectorHook<MemorySettingsState>
  t: (key: MemorySettingsKey) => string
}

/** Props supplied by the rewritten settings shell and this plugin. */
export type MemorySettingsSectionProps = PropsRuntime<'settings.section'> & Partial<MemorySettingsSectionInjected>

function format(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
}

function basename(path: string): string {
  return path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? path
}

/** Render the section only after the slot renderer supplied its inject face. */
export function MemorySettingsSection(props: MemorySettingsSectionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: MemorySettingsSectionInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<MemoryEntryView | undefined>()
  const [clearing, setClearing] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  useEffect(() => { void controller.load() }, [controller])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length === 0) return state.entries
    return state.entries.filter(entry => `${entry.title}\n${entry.content}`.toLocaleLowerCase().includes(needle))
  }, [query, state.entries])

  if (state.status === 'idle' || (state.status === 'loading' && state.entries.length === 0)) {
    return <div className={css.state}>{t('loading')}</div>
  }
  if (state.status === 'unavailable') return <div className={css.state}>{t('unavailable')}</div>

  const busy = state.status === 'saving'
  const resetConfirmation = (): void => {
    setPendingDelete(undefined)
    setClearing(false)
    setAcknowledged(false)
  }
  return (
    <section className={css.section}>
      <header className={css.header}>
        <div>
          <h2>{t('title')}</h2>
          <p>{t('description')}</p>
        </div>
      </header>

      {state.error !== null && (
        <div className={css.error} role="alert">
          <span>{state.error}</span>
          <Button variant="outline" onClick={() => { void controller.load() }}>{t('retry')}</Button>
        </div>
      )}

      <div className={css.controlCard}>
        <div>
          <strong>{t('enabled')}</strong>
          <p>{t('enabledHint')}</p>
          <span>{t('automatic')}</span>
        </div>
        <label className={css.switch}>
          <input
            type="checkbox"
            aria-label={t('enabled')}
            checked={state.enabled}
            disabled={!state.writable || busy}
            onChange={(event) => { void controller.setEnabled(event.currentTarget.checked) }}
          />
          <span aria-hidden="true" />
        </label>
      </div>

      <div className={css.toolbar}>
        <label>
          <span className={css.visuallyHidden}>{t('search')}</span>
          <input value={query} placeholder={t('search')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        </label>
        <span>{format(t('capacity'), { count: String(state.entries.length), max: String(state.maxEntries) })}</span>
        {(state.pendingCount > 0 || state.failedCount > 0) && (
          <span>{format(t('maintenance'), { pending: String(state.pendingCount), failed: String(state.failedCount) })}</span>
        )}
      </div>

      <div className={css.list}>
        {filtered.length === 0 ? (
          <p className={css.empty}>{state.entries.length === 0 ? t('empty') : t('noMatch')}</p>
        ) : filtered.map(entry => (
          <article className={css.entry} key={entry.id}>
            <div className={css.entryHeader}>
              <div>
                <strong>{entry.title}</strong>
                <span>{entry.workspace === undefined ? t('personal') : `${t('project')} · ${basename(entry.workspace)}`}</span>
              </div>
              <div className={css.entryActions}>
                <MemoryEditorAction ids={[entry.id]} controller={controller} useSnapshot={useSnapshot} t={t} />
                <Button variant="outline" disabled={!state.writable || busy} onClick={() => { setPendingDelete(entry); setAcknowledged(false) }}>
                  {t('delete')}
                </Button>
              </div>
            </div>
            <p>{entry.content}</p>
            <small>{format(t('source'), { session: entry.source.sessionId.slice(0, 8), turn: String(entry.source.turn) })}</small>
          </article>
        ))}
      </div>

      <div className={css.danger}>
        <Button variant="outline" disabled={!state.writable || busy || state.entries.length === 0} onClick={() => { setClearing(true); setAcknowledged(false) }}>
          {t('clear')}
        </Button>
      </div>

      <RiskConfirmation
        open={pendingDelete !== undefined || clearing}
        title={clearing ? t('clearTitle') : t('deleteTitle')}
        description={clearing ? t('clearDescription') : t('deleteDescription')}
        acknowledgeLabel={clearing ? t('clearAck') : t('deleteAck')}
        cancelLabel={t('cancel')}
        confirmLabel={clearing ? t('confirmClear') : t('confirmDelete')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={resetConfirmation}
        onConfirm={() => {
          const action = clearing ? controller.clear() : controller.forget(pendingDelete?.id ?? '')
          void action.finally(resetConfirmation)
        }}
      />
    </section>
  )
}
