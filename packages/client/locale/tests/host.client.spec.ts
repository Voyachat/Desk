import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  LOCALE_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  it('registers the preference and resolves live model guidance from it', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt, { persona: '' }).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    expect((await ctx.systemPrompt.assemble()).contexts.find(entry => entry.name === 'user:locale')?.text)
      .toContain('Simplified Chinese (BCP 47: zh-Hans)')
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    expect((await ctx.systemPrompt.assemble()).contexts.find(entry => entry.name === 'user:locale')?.text)
      .toContain('English (BCP 47: en)')
    await expect(ctx.settings.update(ns, { preference: 'fr' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
    expect((await ctx.systemPrompt.assemble()).contexts.some(entry => entry.name === 'user:locale')).toBe(false)
  })
})
