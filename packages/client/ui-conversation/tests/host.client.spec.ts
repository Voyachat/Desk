import { Context } from '@voyaseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@voyaseek-ai/dsh-settings'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_SHOW_REASONING, apply,
} from '@voyaseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable conversation preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      showReasoning: DEFAULT_SHOW_REASONING,
    })
    await ctx.settings.update(ns, { busyEnter: 'steer' })
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: 'steer', showReasoning: DEFAULT_SHOW_REASONING })
    await ctx.settings.update(ns, { showReasoning: true })
    expect(ctx.settings.get(ns)).toEqual({ busyEnter: 'steer', showReasoning: true })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { showReasoning: 'inline' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
