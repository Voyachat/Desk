/**
 * Aistaff product language policy. One Host plugin contributes the three
 * product language behaviors on documented DSH extension points only:
 *
 * - the standing default output language as a system-prompt section resolved
 *   from the user's settings locale preference (product default below it);
 * - per-conversation adaptation as a runtime-context delta derived purely
 *   from logged user messages, so restored sessions replay the same answer;
 * - persisted explicit language rules in the settings document, recorded by
 *   the model through the `language_rule` tool and rendered into every
 *   honoring session's runtime context.
 *
 * @module @deepseek-ai/dsh-aistaff-language-policy
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsProvider, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-only: the AssembleContext `agent` merge the context provider reads.
import type {} from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { conversationLanguage } from './conversation.ts'
import { languageName } from './detect.ts'
import { renderLanguageSection, renderPolicyContext } from './prompt-text.ts'
import {
  LANGUAGE_POLICY_SETTINGS_NAMESPACE, LanguagePolicySettingsSchema, activeRulesFor, renderRules,
  type LanguagePolicySettings, type LanguageRule,
} from './rules.ts'

export { conversationLanguage, MAX_SCANNED_USER_MESSAGES } from './conversation.ts'
export { detectLanguage, languageName } from './detect.ts'
export { renderLanguageSection, renderPolicyContext, type PolicyContextInput } from './prompt-text.ts'
export {
  LANGUAGE_POLICY_SETTINGS_NAMESPACE, LanguagePolicySettingsSchema, activeRulesFor, renderRules,
  type LanguagePolicySettings, type LanguageRule, type LanguageRuleScope,
} from './rules.ts'

/** Cordis plugin id of the language policy. */
export const name = 'aistaff-language-policy'

/** Service required to own the durable language-rule namespace. */
export const inject = ['settings']

/** Deployment choice carried by the composition row. */
export interface Config {
  /** Product default language tag applied while no explicit settings preference exists. */
  defaultLocale: string
}

/** Loader-validated configuration; the bundle row supplies the product value. */
export const Config: z<Config> = z.object({
  defaultLocale: z.string().min(1),
})

/** Section name and order of the standing default-language directive. */
const LANGUAGE_SECTION_NAME = 'product:language'
const LANGUAGE_SECTION_ORDER = 1

/** Context name and order of the per-conversation delta. */
const LANGUAGE_CONTEXT_NAME = 'language:policy'
const LANGUAGE_CONTEXT_ORDER = 15

/** Most persisted rules the store accepts before asking for removals. */
const MAX_RULES = 50

/** Settings namespace the upstream locale preference lives under. */
const LOCALE_SETTINGS_NAMESPACE = settingsNamespace('locale')

/** Settings namespace this plugin owns for persisted explicit rules. */
const LANGUAGE_POLICY_NAMESPACE = settingsNamespace(LANGUAGE_POLICY_SETTINGS_NAMESPACE)

/** Resolve the baseline language: explicit settings preference, else the product default. */
function baselineOf(settings: SettingsProvider, config: Config): string {
  const locale = settings.get(LOCALE_SETTINGS_NAMESPACE) as { preference?: string } | undefined
  return locale?.preference ?? config.defaultLocale
}

/** The model-facing contract of the `language_rule` tool. */
const LANGUAGE_RULE_DESCRIPTION = [
  'Persist, list, or remove explicit user language instructions as standing rules. ',
  'Call it ONLY when the user explicitly asks a language for a scope: ',
  '`scope: "global"` for all future output, `scope: "workspace"` for everything in the current project/workspace, ',
  'or `scope: "target"` for one deliverable (a web page, document, spreadsheet, video, ...) named by `target`. ',
  'The reply language of the current conversation already adapts to the user input automatically — do not record that here. ',
  'Recorded rules persist across sessions and outrank the default output language until removed with `action: "remove"`.',
].join('')

/**
 * Register the language policy: standing section, per-conversation context,
 * and the `language_rule` tool over one settings store.
 * @param ctx - plugin context of the product composition.
 * @param config - product default language chosen by the deployment.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const store: SettingsScope<LanguagePolicySettings> =
      settingsCtx.settings.register(LANGUAGE_POLICY_NAMESPACE, LanguagePolicySettingsSchema)

    settingsCtx.inject(['systemPrompt'], (promptCtx) => {
      promptCtx.systemPrompt.section({
        name: LANGUAGE_SECTION_NAME,
        order: LANGUAGE_SECTION_ORDER,
        text: () => renderLanguageSection(baselineOf(settingsCtx.settings, config)),
      })
      promptCtx.systemPrompt.context({
        name: LANGUAGE_CONTEXT_NAME,
        order: LANGUAGE_CONTEXT_ORDER,
        text: (assembly) => {
          const session = assembly.agent?.session
          if (session === undefined) return ''
          return renderPolicyContext({
            baselineTag: baselineOf(settingsCtx.settings, config),
            detectedTag: conversationLanguage(session.events),
            rulesBlock: renderRules(activeRulesFor(store.get().rules, session)),
          })
        },
      })
    })

    settingsCtx.inject(['tools'], (toolsCtx) => {
      toolsCtx.tools.register(defineTool({
        name: 'language_rule',
        description: LANGUAGE_RULE_DESCRIPTION,
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['add', 'remove', 'list'],
            description: 'add (record a new rule), remove (delete one rule by ruleId), or list (show recorded rules).',
          },
          language: {
            type: 'string',
            description: 'Required for add: requested language as a BCP 47 tag, e.g. "zh-Hans", "en", "ja".',
          },
          scope: {
            type: 'string',
            enum: ['global', 'workspace', 'target'],
            description: 'Required for add: global (all output), workspace (this project), or target (one deliverable).',
          },
          target: {
            type: 'string',
            description: 'Required when scope is target: a short stable description or file path identifying the deliverable.',
          },
          note: {
            type: 'string',
            description: 'Optional short verbatim account of the user request, kept for later display.',
          },
          ruleId: {
            type: 'string',
            description: 'Required for remove: the id of the rule to delete.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              summary: { type: 'string', required: true },
              rules: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    language: { type: 'string', required: true },
                    scope: { type: 'string', required: true },
                    target: { type: 'string' },
                    workspace: { type: 'string' },
                    note: { type: 'string' },
                    createdAt: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        execute(args, exec) {
          if (args.action === 'list') {
            const rules = store.get().rules
            return Promise.resolve({ summary: `Recorded language rules: ${String(rules.length)}.`, rules })
          }
          if (args.action === 'remove') {
            const ruleId = typeof args.ruleId === 'string' ? args.ruleId.trim() : ''
            if (ruleId.length === 0) throw new Error('language_rule remove requires `ruleId`')
            const current = store.get().rules
            if (!current.some(rule => rule.id === ruleId)) {
              throw new Error(`language_rule: no rule with id ${JSON.stringify(ruleId)} (use action "list" to see ids)`)
            }
            const rules = current.filter(rule => rule.id !== ruleId)
            return store.update({ rules }).then(() => ({
              summary: `Removed language rule ${JSON.stringify(ruleId)}.`,
              rules,
            }))
          }
          // add
          const language = typeof args.language === 'string' ? args.language.trim() : ''
          const scope = args.scope
          if (language.length === 0) throw new Error('language_rule add requires a non-empty `language`')
          if (scope !== 'global' && scope !== 'workspace' && scope !== 'target') {
            throw new Error('language_rule add requires `scope` of global, workspace, or target')
          }
          if (scope === 'target' && (typeof args.target !== 'string' || args.target.trim().length === 0)) {
            throw new Error('language_rule add with scope "target" requires `target` naming the deliverable')
          }
          const session = exec.agent?.session
          if (scope === 'workspace' && session === undefined) {
            throw new Error('language_rule add with scope "workspace" requires an owning agent session')
          }
          const current = store.get().rules
          if (current.length >= MAX_RULES) {
            throw new Error(`language_rule store is full (${String(MAX_RULES)} rules); remove obsolete rules first`)
          }
          const workspace = scope === 'workspace' ? session?.header.cwd : undefined
          const target = scope === 'target' ? args.target?.trim() : undefined
          const existing = current.find(rule =>
            rule.scope === scope
            && rule.language === language
            && (rule.target ?? '') === (target ?? '')
            && (rule.workspace ?? '') === (workspace ?? ''))
          if (existing !== undefined) {
            return Promise.resolve({
              summary: `An identical ${scope} rule for ${languageName(language)} is already recorded (${existing.id}).`,
              rules: current,
            })
          }
          const rule: LanguageRule = {
            id: randomUUID(),
            language,
            scope,
            ...target === undefined ? {} : { target },
            ...workspace === undefined ? {} : { workspace },
            ...typeof args.note === 'string' && args.note.trim().length > 0 ? { note: args.note.trim() } : {},
            createdAt: new Date().toISOString(),
          }
          const rules = [...current, rule]
          const scopeLabel = scope === 'global'
            ? 'all output'
            : scope === 'workspace'
              ? 'this workspace'
              : `the deliverable ${JSON.stringify(target ?? '')}`
          return store.update({ rules }).then(() => ({
            summary: `Recorded: use ${languageName(rule.language)} (${rule.language}) for ${scopeLabel}. The rule persists across sessions.`,
            rules,
          }))
        },
        presentCall: args => ({ card: 'generic', title: 'Language rule', kind: 'other', rawInput: args }),
      }))
    })
  })
}
