/** Invariant companion tests over real settings commits. */

import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@voyaseek-ai/dsh-settings'
import InvariantRegistry, { InvariantError } from '@voyaseek-ai/dsh-invariants'
import * as LanguagePolicy from '@voyaseek-ai/dsh-aistaff-language-policy'
import * as LanguagePolicyInvariant from '@voyaseek-ai/dsh-aistaff-language-policy/invariant'
import { LANGUAGE_POLICY_SETTINGS_NAMESPACE } from '../src/rules.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

const POLICY_NS = settingsNamespace(LANGUAGE_POLICY_SETTINGS_NAMESPACE)

/** One schema-valid rule; only the fields under test vary. */
const rule = { id: 'rule-1', language: 'en', scope: 'global', createdAt: '2026-08-17T00:00:00.000Z' }

async function boot(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemorySettings).await()
  await ctx.plugin(LanguagePolicy, { defaultLocale: 'zh' }).await()
  await ctx.plugin(InvariantRegistry, { enabled: true }).await()
  await ctx.plugin(LanguagePolicyInvariant).await()
  return ctx
}

describe('language-policy invariants', () => {
  it('accepts coherent rule stores', async () => {
    const ctx = await boot()
    await expect(ctx.settings.update(POLICY_NS, { rules: [rule] })).resolves.toBeUndefined()
  })

  it('rejects a commit that duplicates a rule id', async () => {
    const ctx = await boot()
    await expect(ctx.settings.update(POLICY_NS, { rules: [rule, rule] }))
      .rejects.toThrow(new InvariantError(
        '@voyaseek-ai/dsh-aistaff-language-policy',
        'language rule id "rule-1" is recorded more than once',
      ))
  })

  it('rejects a workspace rule without a workspace', async () => {
    const ctx = await boot()
    const broken = { ...rule, scope: 'workspace' }
    await expect(ctx.settings.update(POLICY_NS, { rules: [broken] }))
      .rejects.toMatchObject({ code: 'INVARIANT' })
  })

  it('rejects a target rule without a target', async () => {
    const ctx = await boot()
    const broken = { ...rule, scope: 'target' }
    await expect(ctx.settings.update(POLICY_NS, { rules: [broken] }))
      .rejects.toMatchObject({ code: 'INVARIANT' })
  })

  it('ignores unrelated settings namespaces', async () => {
    const ctx = await boot()
    ctx.emit('settings/updated', settingsNamespace('locale'), { preference: 'en' }, {}, 'update')
  })

  it('rejects an incoherent store already present at late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(LanguagePolicy, { defaultLocale: 'zh' }).await()
    await ctx.settings.update(POLICY_NS, { rules: [rule, rule] })
    await ctx.plugin(InvariantRegistry, { enabled: true }).await()
    await expect(ctx.plugin(LanguagePolicyInvariant).then(() => undefined)).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: '@voyaseek-ai/dsh-aistaff-language-policy',
    })
  })
})
