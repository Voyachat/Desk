/** Register the long-term memory page through the stable settings.section contract. */

import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@voyaseek-ai/dsh-api-remotes/client'
import { bindSnapshotSelector } from '@voyaseek-ai/dsh-client-web-react'
import type {} from '@voyaseek-ai/dsh-client-ui-settings/client'
import type {} from '@voyaseek-ai/dsh-client-locale/client'
import { MemorySettingsSection, type MemorySettingsSectionInjected } from './MemorySettingsSection.tsx'
import { en, zh, type MemorySettingsKey } from './locales.ts'
import { AGENT_MEMORY_SETTINGS_NAMESPACE, MemorySettingsStore } from './store.ts'
import {
  memoryMaintenanceDefinition, memoryMaintenanceRenderer, memoryRecallActionRenderer,
} from './MemoryConversation.tsx'

declare module '@voyaseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.memory': MemorySettingsKey
  }
}

const NS = 'settings.memory'
/** Client services required by the page registration and its invalidations. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'conversationEvents']

/** Install a shell-independent section registration and pushed refreshes. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-memory: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return
  const controller = new MemorySettingsStore(connection.api)
  const useSnapshot = bindSnapshotSelector(controller.store)
  const t = ctx.locale.bind(NS) as MemorySettingsSectionInjected['t']
  const injected = (): MemorySettingsSectionInjected => ({ controller, useSnapshot, t })
  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status !== 'idle') void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === AGENT_MEMORY_SETTINGS_NAMESPACE) refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { controller.dispose(); for (const dispose of disposers) dispose() }
  }, 'ui-settings-memory: invalidations')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'memory',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemorySettingsSection))
  ctx.effect(
    () => ctx.conversationEvents.register(memoryMaintenanceDefinition),
    'ui-settings-memory: maintenance conversation definition',
  )
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'memory-maintenance',
  }, memoryMaintenanceRenderer(injected())))
  ctx.slots.inject('conversation.chat.context-actions', () => ctx.slots.register({
    name: 'conversation.chat.context-actions', id: 'memory-editor', order: 20,
  }, memoryRecallActionRenderer(injected())))
}

export type { MemorySettingsSectionInjected } from './MemorySettingsSection.tsx'
export type { MemorySettingsState, MemoryEntryView } from './store.ts'
export type { MemoryMaintenanceNode } from './MemoryConversation.tsx'
