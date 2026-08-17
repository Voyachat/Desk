/** Package-owned invariants for the Aistaff language policy rule store. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
// Type-only: the `settings/updated` event merge this companion listens to.
import type {} from '@deepseek-ai/dsh-settings'
import {
  LANGUAGE_POLICY_SETTINGS_NAMESPACE, type LanguagePolicySettings, type LanguageRule,
} from './rules.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-aistaff-language-policy'

/** Cordis companion plugin name. */
export const name = 'aistaff-language-policy-invariant'

/** Services required before the companion can register. */
export const inject = ['invariants']

const NAMESPACE = settingsNamespace(LANGUAGE_POLICY_SETTINGS_NAMESPACE)

/** The scope-field coherence one rule must keep. */
function scopeProblem(rule: LanguageRule): string | undefined {
  if (rule.scope === 'workspace' && rule.workspace === undefined) return `rule ${rule.id} has scope "workspace" without a workspace`
  if (rule.scope === 'target' && rule.target === undefined) return `rule ${rule.id} has scope "target" without a target`
  return undefined
}

/** One coherence check over a complete rule list. */
function check(rules: readonly LanguageRule[], fail: InvariantFailure): void {
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) fail(`language rule id ${JSON.stringify(rule.id)} is recorded more than once`)
    seen.add(rule.id)
    const problem = scopeProblem(rule)
    if (problem !== undefined) fail(problem)
  }
}

/** Assert that every committed rule store keeps unique ids and coherent scopes. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const current = ctx.settings.get(NAMESPACE) as LanguagePolicySettings | undefined
  if (current !== undefined) check(current.rules, fail)
  ctx.on('settings/updated', (ns, next) => {
    if (ns !== NAMESPACE) return
    check((next as LanguagePolicySettings).rules, fail)
  })
}, { inject: ['settings'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
