/**
 * Persisted explicit language rules: the durable memory of user requests such
 * as "this web page stays in English". Rules live in the Host settings
 * document under the `aistaff-language` namespace and outrank both the
 * configured default and the detected conversation language for the scope
 * they name.
 * @module @voyaseek-ai/dsh-aistaff-language-policy/rules
 */

import { sep } from 'node:path'
import z from '@voyaseek-ai/schemastery'
import type { Session } from '@voyaseek-ai/dsh-session'
import { languageName } from './detect.ts'

/** Settings namespace owned by the language policy plugin. */
export const LANGUAGE_POLICY_SETTINGS_NAMESPACE = 'aistaff-language'

/** Where one explicit rule applies. */
export type LanguageRuleScope = 'global' | 'workspace' | 'target'

/** One persisted explicit language instruction. */
export interface LanguageRule {
  /** Stable identity minted by the Host at creation. */
  id: string
  /** Requested language as a BCP 47 tag (`zh-Hans`, `en`, …). */
  language: string
  /** Application breadth this rule was recorded with. */
  scope: LanguageRuleScope
  /** Deliverable the rule targets; present exactly when scope is `target`. */
  target?: string
  /** Absolute workspace root the rule covers; present exactly when scope is `workspace`. */
  workspace?: string
  /** Short account of the user's own words, kept for display. */
  note?: string
  /** ISO instant the rule was recorded. */
  createdAt: string
}

/** Durable section stored under the `aistaff-language` namespace. */
export interface LanguagePolicySettings {
  /** Recorded rules in creation order. */
  rules: LanguageRule[]
}

const RULE_SCOPES = ['global', 'workspace', 'target'] as const

/** One persisted rule as validated by the settings schema. */
const LanguageRuleSchema: z<LanguageRule> = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  scope: z.union([...RULE_SCOPES]),
  target: z.string().required(false),
  workspace: z.string().required(false),
  note: z.string().required(false),
  createdAt: z.string().min(1),
})

/** Durable language-policy schema registered on the Host settings document. */
export const LanguagePolicySettingsSchema: z<LanguagePolicySettings> = z.object({
  rules: z.array(LanguageRuleSchema).default([]),
})

/** Whether one absolute path lies inside one workspace root. */
function insideWorkspace(root: string, path: string): boolean {
  const base = root.endsWith(sep) ? root : root + sep
  return path === root || path.startsWith(base)
}

/**
 * The rules one session must honor: every `global` rule, every `workspace`
 * rule covering the session's cwd, and every `target` rule (the model judges
 * relevance to the deliverable it is producing).
 * @param rules - all persisted rules.
 * @param session - session whose workspace filters `workspace` rules; absent sessions see globals and targets only.
 * @returns applicable rules in creation order.
 */
export function activeRulesFor(rules: readonly LanguageRule[], session: Session | undefined): LanguageRule[] {
  return rules.filter((rule) => {
    if (rule.scope === 'workspace') {
      const cwd = session?.header.cwd
      return cwd !== undefined && rule.workspace !== undefined && insideWorkspace(rule.workspace, cwd)
    }
    return true
  })
}

/** One rule as one line of model-facing text. */
function renderRule(rule: LanguageRule): string {
  const name = languageName(rule.language)
  const scope = rule.scope === 'global'
    ? 'all output'
    : rule.scope === 'workspace'
      ? `the workspace ${JSON.stringify(rule.workspace ?? '')}`
      : `the deliverable ${JSON.stringify(rule.target ?? '')}`
  const note = rule.note === undefined || rule.note.length === 0 ? '' : ` (user: ${rule.note})`
  return `- Use ${name} (${rule.language}) for ${scope}${note}.`
}

/**
 * Model-facing block listing persisted explicit rules.
 * @param rules - applicable rules, already filtered for the session.
 * @returns the rendered block, or `''` without rules.
 */
export function renderRules(rules: readonly LanguageRule[]): string {
  if (rules.length === 0) return ''
  return `Explicit language rules recorded from the user. They persist across sessions and outrank the default output language until the user revokes them:\n${rules.map(renderRule).join('\n')}\nFor every deliverable a rule covers, write that deliverable's user-facing content in the rule language even when your reply language differs.`
}
