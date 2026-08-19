/** Remote-view settings page registration. */

import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@voyaseek-ai/dsh-api-remotes/client'
import type {} from '@voyaseek-ai/dsh-client-ui-settings/client'
import type {} from '@voyaseek-ai/dsh-client-locale/client'
import type {} from '@voyaseek-ai/dsh-api-remotes/client'
import { RemoteViewSection, type RemoteViewSectionInjected } from './RemoteViewSection.tsx'
import { MobileViewSettingsStore } from './store.ts'
import { en, zh, type MobileViewKey } from './locales.ts'

export type { MobileViewSettingsState, ListenerStatus } from './store.ts'
export type { MobileViewKey } from './locales.ts'
export type { RemoteViewSectionInjected, RemoteViewSectionProps } from './RemoteViewSection.tsx'

declare module '@voyaseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Remote-view settings copy. */
    'settings.mobile-view': MobileViewKey
  }
}

const NS = 'settings.mobile-view'

/** Services required to register and refresh the loopback-only settings page. */
export const inject = ['slots', 'locale', 'connection', 'remote']

/** Register the Remote View page for the local desktop/browser connection. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-mobile-view: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  if (!connection.isLoopback) return
  const controller = new MobileViewSettingsStore(connection.api)
  const t = ctx.locale.bind(NS)
  const injected = (): RemoteViewSectionInjected => ({
    hooks: { mobileView: controller.store },
    load: () => controller.load(),
    enable: () => controller.enable(),
    disable: () => controller.disable(),
    setPort: port => controller.setPort(port),
    regenerateToken: () => controller.regenerateToken(),
  })

  ctx.effect(() => {
    const refresh = (): void => {
      if (controller.store.getSnapshot().status === 'idle') return
      void controller.load()
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', (namespace) => {
        if (namespace === 'mobile-view') refresh()
      }),
      ctx.remote.$on('credentials/updated', (ref) => {
        if (ref === 'VOYASEEK_MOBILE_VIEW_TOKEN') refresh()
      }),
      ctx.on('connection/reset', refresh),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'ui-settings-mobile-view: invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mobile-view',
    order: 30,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, RemoteViewSection))
}
