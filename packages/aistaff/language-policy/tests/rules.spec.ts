import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import { activeRulesFor, renderRules, type LanguageRule } from '../src/rules.ts'

/** Build one persisted rule with sensible defaults. */
function rule(partial: Partial<LanguageRule> & Pick<LanguageRule, 'scope' | 'language'>): LanguageRule {
  return { id: 'rule-1', createdAt: '2026-08-17T00:00:00.000Z', ...partial }
}

/** Fabricate the session fields the matcher reads. */
function sessionWithCwd(cwd: string): Session {
  return { header: { cwd } } as unknown as Session
}

describe('activeRulesFor', () => {
  it('keeps global and target rules for every session', () => {
    const rules = [
      rule({ scope: 'global', language: 'zh-Hans' }),
      rule({ scope: 'target', language: 'en', target: 'landing page' }),
    ]
    expect(activeRulesFor(rules, undefined)).toHaveLength(2)
    expect(activeRulesFor(rules, sessionWithCwd('/tmp/anywhere'))).toHaveLength(2)
  })

  it('keeps a workspace rule only inside its workspace', () => {
    const rules = [rule({ scope: 'workspace', language: 'en', workspace: '/work/site' })]
    expect(activeRulesFor(rules, sessionWithCwd('/work/site'))).toHaveLength(1)
    expect(activeRulesFor(rules, sessionWithCwd('/work/site/nested'))).toHaveLength(1)
    expect(activeRulesFor(rules, sessionWithCwd('/work/site-other'))).toHaveLength(0)
    expect(activeRulesFor(rules, undefined)).toHaveLength(0)
  })

  it('drops workspace rules that lost their root', () => {
    const rules = [rule({ scope: 'workspace', language: 'en' })]
    expect(activeRulesFor(rules, sessionWithCwd('/work/site'))).toHaveLength(0)
  })
})

describe('renderRules', () => {
  it('renders nothing without rules', () => {
    expect(renderRules([])).toBe('')
  })

  it('lists each rule with language, scope, and note', () => {
    const text = renderRules([
      rule({ id: 'a', scope: 'target', language: 'en', target: 'landing page', note: '按钮用英语' }),
      rule({ id: 'b', scope: 'global', language: 'zh-Hans' }),
    ])
    expect(text).toContain('Use English (en) for the deliverable "landing page" (user: 按钮用英语).')
    expect(text).toContain('Use Simplified Chinese (zh-Hans) for all output.')
    expect(text).toContain('persist across sessions')
  })

  it('names the workspace root for workspace rules', () => {
    const text = renderRules([rule({ scope: 'workspace', language: 'ja', workspace: '/work/jp' })])
    expect(text).toContain('the workspace "/work/jp"')
  })
})
