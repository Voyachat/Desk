// @vitest-environment jsdom
/** CSS regression coverage for the fetched-model picker scrollport. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(
  process.cwd(),
  'packages/client/ui-settings-models/src/client/ModelsSection.module.css',
), 'utf8')

function styleRule(sheet: CSSStyleSheet, selector: string): CSSStyleRule | undefined {
  return Array.from(sheet.cssRules).find((rule): rule is CSSStyleRule =>
    'selectorText' in rule && rule.selectorText === selector)
}

afterEach(() => { document.head.replaceChildren() })

describe('fetched-model picker styles', () => {
  it('keeps actions and the capped scrollport as top-level rules', () => {
    const style = document.createElement('style')
    style.textContent = SOURCE
    document.head.append(style)
    const sheet = style.sheet
    expect(sheet).not.toBeNull()
    if (sheet === null) throw new Error('model settings stylesheet did not parse')

    expect(styleRule(sheet, '.candidateActions')).toBeDefined()
    const list = styleRule(sheet, '.candidateList')
    expect(list).toBeDefined()
    expect(list?.style.maxHeight).toBe('320px')
    expect(list?.style.overflowY).toBe('auto')
  })
})
