/** Shared exact-item editor used by the conversation trace and Settings page. */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, IconEditOutline16, Modal } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { MemorySettingsSectionInjected } from './MemorySettingsSection.tsx'
import type { MemoryEntryView } from './store.ts'
import css from './MemoryEditor.module.css'

/** Props for one low-emphasis memory editor entry. */
export interface MemoryEditorActionProps extends MemorySettingsSectionInjected {
  ids: readonly string[]
  compact?: boolean
}

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

/** Open a bounded exact-item editor for the supplied provider identities. */
export function MemoryEditorAction({ ids, compact = false, controller, useSnapshot, t }: MemoryEditorActionProps): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const acceptedIds = useMemo(() => normalizedIds(ids), [ids])
  const entries = useMemo(() => acceptedIds.flatMap((id) => {
    const entry = state.entries.find(candidate => candidate.id === id)
    return entry === undefined ? [] : [entry]
  }), [acceptedIds, state.entries])
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0]

  useEffect(() => {
    if (!open) return
    void controller.load()
  }, [controller, open])

  if (acceptedIds.length === 0) return null
  return (
    <>
      <button
        type="button"
        className={compact ? css.compactTrigger : css.trigger}
        onClick={() => { setOpen(true) }}
      >
        <IconEditOutline16 size={13} />
        {t('edit')}
      </button>
      <MemoryEditorDialog
        open={open}
        entries={entries}
        selected={selected}
        busy={state.status === 'saving' || state.status === 'loading'}
        error={state.error}
        controller={controller}
        t={t}
        onSelect={setSelectedId}
        onClose={() => { setOpen(false); setSelectedId(undefined) }}
      />
    </>
  )
}

function MemoryEditorDialog({
  open, entries, selected, busy, error, controller, t, onSelect, onClose,
}: {
  open: boolean
  entries: readonly MemoryEntryView[]
  selected: MemoryEntryView | undefined
  busy: boolean
  error: string | null
  controller: MemorySettingsSectionInjected['controller']
  t: MemorySettingsSectionInjected['t']
  onSelect: (id: string) => void
  onClose: () => void
}): ReactNode {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [keywords, setKeywords] = useState('')

  useEffect(() => {
    setTitle(selected?.title ?? '')
    setContent(selected?.content ?? '')
    setKeywords(selected?.keywords.join('，') ?? '')
  }, [selected])

  const valid = selected !== undefined && title.trim().length > 0 && content.trim().length > 0
  const save = async (): Promise<void> => {
    if (selected === undefined || !valid) return
    const saved = await controller.update(selected.id, {
      title: title.trim(),
      content: content.trim(),
      keywords: keywords.split(/[,，\n]/u).map(value => value.trim()).filter(Boolean),
    })
    if (saved) onClose()
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('editTitle')}
      closeLabel={t('cancel')}
      description={t('editDescription')}
      {...css.modalContent === undefined ? {} : { contentClassName: css.modalContent }}
      footer={(
        <>
          <Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={busy || !valid} onClick={() => { void save() }}>{t('save')}</Button>
        </>
      )}
    >
      {entries.length > 1 && (
        <div className={css.choices} aria-label={t('chooseMemory')}>
          {entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              data-selected={entry.id === selected?.id || undefined}
              onClick={() => { onSelect(entry.id) }}
            >
              {entry.title}
            </button>
          ))}
        </div>
      )}
      {selected === undefined ? (
        <p className={css.missing}>{busy ? t('loading') : t('memoryMissing')}</p>
      ) : (
        <div className={css.form}>
          <label>{t('fieldTitle')}<input value={title} maxLength={120} onChange={(event) => { setTitle(event.currentTarget.value) }} /></label>
          <label>{t('fieldContent')}<textarea value={content} maxLength={2_000} rows={5} onChange={(event) => { setContent(event.currentTarget.value) }} /></label>
          <label>{t('fieldKeywords')}<input value={keywords} onChange={(event) => { setKeywords(event.currentTarget.value) }} /></label>
        </div>
      )}
      {error !== null && <p className={css.error} role="alert">{error}</p>}
    </Modal>
  )
}
