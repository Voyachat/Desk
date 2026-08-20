/** Durable memory trace rows and edit actions contributed to the conversation flow. */

import type { ReactNode } from 'react'
import type { ConversationNodeDefinition } from '@voyaseek-ai/dsh-client-runtime/client'
import type { MemoryMaintenanceChange } from '@voyaseek-ai/dsh-agent-memory'
import { IconSparkle16 } from '@voyaseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@voyaseek-ai/dsh-client-ui-slots'
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
import type { MemorySettingsSectionInjected } from './MemorySettingsSection.tsx'
import { MemoryEditorAction } from './MemoryEditor.tsx'
import css from './MemoryConversation.module.css'

/** Conversation projection of one committed maintenance event. */
export interface MemoryMaintenanceNode {
  readonly seq: number
  readonly time: number
  readonly turn: number
  readonly status: 'changed' | 'unchanged' | 'failed'
  readonly changes: readonly MemoryMaintenanceChange[]
}

declare module '@voyaseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Automatic long-term memory maintenance committed after one turn. */
    'memory-maintenance': MemoryMaintenanceNode
  }
}

/** Convert one durable maintenance record into a low-emphasis Chat row. */
export const memoryMaintenanceDefinition: ConversationNodeDefinition<MemoryMaintenanceNode> = {
  kind: 'memory-maintenance',
  target: 'chat',
  match: event => event.type === 'agent-memory/maintenance' && event.data.status !== 'unchanged'
    ? { id: `${String(event.data.turn)}:${String(event.seq)}`, role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'agent-memory/maintenance') throw new Error('memory-maintenance start requires agent-memory/maintenance')
    const event = match.event
    return { seq: event.seq, time: event.time, ...event.data }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined || context.start === undefined) return null
    return {
      key: context.key,
      kind: 'memory-maintenance',
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state,
    }
  },
}

type Injected = MemorySettingsSectionInjected
type MaintenanceProps = PropsRuntime<'conversation.chat.node', 'memory-maintenance'> & Injected
type ContextActionProps = PropsRuntime<'conversation.chat.context-actions'> & Injected

function format(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)
}

function count(changes: readonly MemoryMaintenanceChange[], action: MemoryMaintenanceChange['action']): number {
  return changes.filter(change => change.action === action).length
}

function memoryIds(source: ContextActionProps['source']): string[] {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return []
  const record = source as { kind?: unknown; items?: unknown }
  if (record.kind !== 'agent-memory' || !Array.isArray(record.items)) return []
  return record.items.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
    const id = (item as { id?: unknown }).id
    return typeof id === 'string' && id.length > 0 ? [id] : []
  })
}

/** Render committed automatic maintenance without competing with the answer. */
export function MemoryMaintenanceRow(props: MaintenanceProps): ReactNode {
  const { controller, useSnapshot, t } = props
  const data = props.node.data
  const ids = data.changes.filter(change => change.action !== 'deleted').map(change => String(change.id))
  const parts = [
    ['created', 'changeCreated'], ['updated', 'changeUpdated'], ['deleted', 'changeDeleted'],
  ] as const
  const summary = data.status === 'failed'
    ? t('maintainedFailed')
    : data.status === 'unchanged'
      ? t('maintainedUnchanged')
      : t('maintainedChanged')
  return (
    <div className={css.row} data-memory-maintenance={data.status} role="status">
      <IconSparkle16 size={13} />
      <span className={css.summary}>{summary}</span>
      {data.status === 'changed' && parts.map(([action, key]) => {
        const total = count(data.changes, action)
        return total === 0 ? null : <span key={action} className={css.count}>{format(t(key), { count: String(total) })}</span>
      })}
      <MemoryEditorAction ids={ids} compact controller={controller} useSnapshot={useSnapshot} t={t} />
    </div>
  )
}

/** Add an editor only to context rows produced by automatic memory recall. */
export function MemoryRecallAction(props: ContextActionProps): ReactNode {
  const { controller, useSnapshot, t } = props
  const ids = memoryIds(props.source)
  return <MemoryEditorAction ids={ids} compact controller={controller} useSnapshot={useSnapshot} t={t} />
}

/** Bind the page-scoped memory controller to a keyed Chat renderer. */
export function memoryMaintenanceRenderer(injected: Injected): (props: PropsRuntime<'conversation.chat.node', 'memory-maintenance'>) => ReactNode {
  return props => <MemoryMaintenanceRow {...props} {...injected} />
}

/** Bind the same controller to the additive recalled-context action. */
export function memoryRecallActionRenderer(injected: Injected): (props: PropsRuntime<'conversation.chat.context-actions'>) => ReactNode {
  return props => <MemoryRecallAction {...props} {...injected} />
}
