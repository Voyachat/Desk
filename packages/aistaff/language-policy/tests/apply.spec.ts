/**
 * Real-composition tests: the language policy plugin boots beside the actual
 * settings provider, system-prompt registry, and tool registry, and the
 * registered section, context, and `language_rule` tool are exercised through
 * those services.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as LanguagePolicy from '@deepseek-ai/dsh-aistaff-language-policy'
import { LANGUAGE_POLICY_SETTINGS_NAMESPACE } from '../src/rules.ts'

const POLICY_NS = settingsNamespace(LANGUAGE_POLICY_SETTINGS_NAMESPACE)
const LOCALE_NS = settingsNamespace('locale')
const LocaleSettingsSchema = z.object({
  preference: z.union(['zh', 'en']).required(false),
})

/** Minimal stand-in for the tool execution context. */
const NO_AGENT = { agent: undefined } as never

/** A tool execution context whose session sits in one workspace. */
function agentIn(cwd: string): never {
  return { agent: { session: { header: { cwd }, events: [] } } } as never
}

async function boot(initialDocument: Record<string, unknown> = {}): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const document = structuredClone(initialDocument)
  // Closure provider so each boot owns its document; the class shape keeps the
  // real SettingsProvider lifecycle (load-once, serialized writes).
  class DocumentSettings extends SettingsProvider {
    readonly writable = true
    protected load(): Promise<Record<string, unknown>> { return Promise.resolve(document) }
    protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
      document[ns] = section
      return Promise.resolve()
    }
  }
  const ctx = new Context()
  await ctx.plugin(DocumentSettings).await()
  await ctx.plugin(SystemPrompt, { persona: '' }).await()
  await ctx.plugin(ToolRuntime).await()
  ctx.settings.register(LOCALE_NS, LocaleSettingsSchema)
  const fiber = ctx.plugin(LanguagePolicy, { defaultLocale: 'zh' })
  await fiber.await()
  return { ctx, fiber }
}

/** The registered tool definition, failing loud when absent. */
function toolOf(ctx: Context): {
  execute(args: Record<string, unknown>, exec: never): Promise<{ summary: string; rules: { id: string }[] }>
} {
  const definition = ctx.tools.get('language_rule')
  if (definition === undefined) throw new Error('language_rule tool not registered')
  return definition as never
}

describe('aistaff language policy composition', () => {
  it('renders the product default section and an empty delta without a session', async () => {
    const { ctx, fiber } = await boot()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'product:language')?.text)
      .toContain('Default output language: Simplified Chinese (zh).')
    expect(assembly.contexts.find(entry => entry.name === 'language:policy')?.text).toBe('')
    await fiber.dispose()
  })

  it('follows the upstream locale preference once persisted', async () => {
    const { ctx, fiber } = await boot({ locale: { preference: 'en' } })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'product:language')?.text)
      .toContain('Default output language: English (en).')
    await fiber.dispose()
  })

  it('registers the language_rule tool into the global catalog', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.tools.get('language_rule')).toBeDefined()
    expect(ctx.tools.schemas().some(schema => schema.name === 'language_rule')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.get('language_rule')).toBeUndefined()
  })

  it('records, deduplicates, lists, and removes explicit rules through the tool', async () => {
    const { ctx, fiber } = await boot()
    const tool = toolOf(ctx)

    const added = await tool.execute(
      { action: 'add', language: 'en', scope: 'target', target: 'landing page', note: '按钮用英语' }, NO_AGENT)
    expect(added.rules).toHaveLength(1)
    expect(added.summary).toContain('the deliverable "landing page"')

    const duplicate = await tool.execute(
      { action: 'add', language: 'en', scope: 'target', target: 'landing page' }, NO_AGENT)
    expect(duplicate.rules).toHaveLength(1)
    expect(duplicate.summary).toContain('already recorded')

    const listed = await tool.execute({ action: 'list' }, NO_AGENT)
    expect(listed.summary).toContain('1')

    const first = added.rules[0]
    if (first === undefined) throw new Error('expected one recorded rule')
    const removed = await tool.execute({ action: 'remove', ruleId: first.id }, NO_AGENT)
    expect(removed.rules).toHaveLength(0)
    expect((ctx.settings.get(POLICY_NS) as { rules: unknown[] }).rules).toHaveLength(0)
    await fiber.dispose()
  })

  it('records workspace rules from the calling session cwd', async () => {
    const { ctx, fiber } = await boot()
    const tool = toolOf(ctx)
    const added = await tool.execute({ action: 'add', language: 'ja', scope: 'workspace' }, agentIn('/work/jp'))
    expect(added.summary).toContain('this workspace')
    const rules = (ctx.settings.get(POLICY_NS) as { rules: { workspace?: string }[] }).rules
    expect(rules[0]?.workspace).toBe('/work/jp')
    await fiber.dispose()
  })

  it('rejects malformed tool calls with actionable errors', async () => {
    const { ctx, fiber } = await boot()
    const tool = toolOf(ctx)
    await expect(tool.execute({ action: 'add', language: 'en' }, NO_AGENT))
      .rejects.toThrow('requires `scope`')
    await expect(tool.execute({ action: 'add', language: 'en', scope: 'target' }, NO_AGENT))
      .rejects.toThrow('requires `target`')
    await expect(tool.execute({ action: 'add', language: '', scope: 'global' }, NO_AGENT))
      .rejects.toThrow('non-empty `language`')
    await expect(tool.execute({ action: 'add', language: 'en', scope: 'workspace' }, NO_AGENT))
      .rejects.toThrow('requires an owning agent session')
    await expect(tool.execute({ action: 'remove', ruleId: 'missing' }, NO_AGENT))
      .rejects.toThrow('no rule with id')
    await expect(tool.execute({ action: 'remove' }, NO_AGENT))
      .rejects.toThrow('requires `ruleId`')
    await fiber.dispose()
  })

  it('releases section, context, and settings namespace on dispose', async () => {
    const { ctx, fiber } = await boot()
    await fiber.dispose()
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(section => section.name === 'product:language')).toBe(false)
    expect(assembly.contexts.some(entry => entry.name === 'language:policy')).toBe(false)
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(POLICY_NS)
  })
})
