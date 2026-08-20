import { useState, type ReactNode } from 'react'
import type { ContextMessageNode } from '@voyaseek-ai/dsh-client-runtime/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconBrowseOutline16 } from '@voyaseek-ai/dsh-client-ui-primitives'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
  /** Feature-owned controls for this exact durable context source. */
  actions?: ReactNode
}

function isAgentMemorySource(source: unknown): boolean {
  return typeof source === 'object' && source !== null && !Array.isArray(source)
    && (source as { kind?: unknown }).kind === 'agent-memory'
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 * @param props - Durable content, its projected producer role/name and form, and the locale seat.
 * @returns A collapsed context row with a bounded, form-specific body.
 */
export function ContextInjectionRow({ content, source, provenance, form, t, actions }: ContextInjectionRowProps) {
  const [open, setOpen] = useState(false)
  const memory = isAgentMemorySource(source)
  // Resolved rather than declared: a form whose fields are unreadable renders
  // the opaque body, and the marker must say what the row actually shows.
  const { rendered, summary, body } = contextBody(form, { content, source, t })

  return (
    <DisclosureRow
      className={`${css.root}${memory ? ` ${css.memory}` : ''}`}
      icon={<IconBrowseOutline16 size={14} />}
      chevronClassName={css.chevron}
      title={t(memory ? 'message.memory.recalled' : provenance.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
      collapsedContent={provenance.label === null && actions === undefined ? undefined : (
        /* ToolRow's separator shape: an aria-hidden dot, so the accessible name
           stays the two readable parts and the two disclosure rows expose one
           name shape. A source that names no producer drops the dot with it. */
        <>
          {provenance.label !== null && (
            <><span className={css.sep} aria-hidden /><span className={css.source} data-context-source>{provenance.label}</span></>
          )}
          {summary !== null && (
            <>
              <span className={css.sep} aria-hidden />
              <span className={css.summary} data-context-summary>{summary}</span>
            </>
          )}
          {actions !== undefined && (
            <span className={css.actions} onClick={(event) => { event.stopPropagation() }}>{actions}</span>
          )}
        </>
      )}
      keepContentWhenOpen
      open={open}
      expandable
      expandOnRowClick
      onToggle={() => { setOpen(value => !value) }}
    >
      <div className={css.body} data-context-injection-body data-context-form={rendered ?? undefined}>
        {body}
      </div>
    </DisclosureRow>
  )
}
