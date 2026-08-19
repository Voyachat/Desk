/** Remote-view Settings registration and connection trust boundary. */

import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@voyaseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@voyaseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@voyaseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@voyaseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { RemoteViewSection } from '../src/client/RemoteViewSection.tsx'
import type { RemoteViewSectionInjected } from '../src/client/RemoteViewSection.tsx'

usePinnedBrowserLanguages('zh-CN')

async function bench(isLoopback: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  new TestRemote(ctx)
  ctx.provide('connection', { isLoopback, api: {} } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  return { ctx, slots }
}

describe('ui-settings-mobile-view apply', () => {
  it('registers the localized page and its observable/actions only for loopback', async () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote'])
    const local = await bench(true)
    await local.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = local.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(RemoteViewSection)
    expect(entry.options).toMatchObject({ id: 'mobile-view', order: 30 })
    expect(resolveSlotLabel(entry.options.label)).toBe('远程查看')
    const face = (entry.inject as unknown as () => RemoteViewSectionInjected)()
    expect(face.hooks.mobileView.getSnapshot().status).toBe('idle')
    expect(typeof face.enable).toBe('function')
    expect(typeof face.disable).toBe('function')

    const remote = await bench(false)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    expect(remote.slots.entries('settings.section')).toHaveLength(0)
  })
})
