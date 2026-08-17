import { describe, expect, it } from 'vitest'
import { renderLanguageSection, renderPolicyContext } from '../src/prompt-text.ts'

describe('renderLanguageSection', () => {
  it('pins the standing directive for the product default', () => {
    const text = renderLanguageSection('zh')
    expect(text).toContain('Default output language: Simplified Chinese (zh).')
    expect(text).toContain('web pages, applications, spreadsheets and tables, documents, presentations, image text, audio, and video')
    expect(text).toContain('unless the runtime context states an active language policy')
    expect(text).toContain('never translate code, identifiers, commands, or file paths')
    expect(text).toContain('language_rule tool')
  })

  it('names any configured language', () => {
    expect(renderLanguageSection('en')).toContain('Default output language: English (en).')
  })
})

describe('renderPolicyContext', () => {
  it('stays empty while the baseline fully describes the session', () => {
    expect(renderPolicyContext({ baselineTag: 'zh', detectedTag: 'zh', rulesBlock: '' })).toBe('')
    expect(renderPolicyContext({ baselineTag: 'zh', rulesBlock: '' })).toBe('')
  })

  it('overrides the reply language with the detected input language', () => {
    const text = renderPolicyContext({ baselineTag: 'zh', detectedTag: 'en', rulesBlock: '' })
    expect(text).toContain('Active conversation language: English (en) — detected from the user\'s own input.')
    expect(text).toContain('overriding the default output language above')
  })

  it('carries persisted explicit rules', () => {
    const rulesBlock = 'Explicit language rules recorded from the user.'
    const text = renderPolicyContext({ baselineTag: 'zh', rulesBlock })
    expect(text).toBe(rulesBlock)
  })

  it('joins detection and rules into one delta', () => {
    const text = renderPolicyContext({ baselineTag: 'zh', detectedTag: 'ja', rulesBlock: 'RULES' })
    expect(text).toContain('Active conversation language: Japanese (ja)')
    expect(text).toContain('\n\nRULES')
  })
})
