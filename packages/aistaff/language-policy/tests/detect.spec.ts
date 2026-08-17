import { describe, expect, it } from 'vitest'
import { detectLanguage, languageName } from '../src/detect.ts'

describe('detectLanguage', () => {
  it('detects Chinese from pure and short input', () => {
    expect(detectLanguage('帮我做一个网页')).toBe('zh')
    expect(detectLanguage('好的')).toBe('zh')
  })

  it('keeps the Chinese verdict while Latin terms are embedded', () => {
    expect(detectLanguage('帮我写一个 React component，谢谢')).toBe('zh')
  })

  it('detects English through function words', () => {
    expect(detectLanguage('please make a web page for me')).toBe('en')
    expect(detectLanguage('Submit the report and thank you')).toBe('en')
  })

  it('returns undefined for Latin text without any function word', () => {
    expect(detectLanguage('React Vue Angular Svelte')).toBeUndefined()
  })

  it('detects Japanese through kana', () => {
    expect(detectLanguage('こんにちは、ページを作ってください')).toBe('ja')
  })

  it('detects Korean through hangul', () => {
    expect(detectLanguage('안녕하세요 페이지를 만들어 주세요')).toBe('ko')
  })

  it('distinguishes other Latin-script languages by vocabulary', () => {
    expect(detectLanguage('bonjour, je veux une page web')).toBe('fr')
    expect(detectLanguage('hallo ich möchte bitte eine webseite')).toBe('de')
    expect(detectLanguage('hola, quiero una página web por favor')).toBe('es')
  })

  it('detects non-Latin scripts', () => {
    expect(detectLanguage('привет, сделай пожалуйста страницу')).toBe('ru')
    expect(detectLanguage('مرحبا من فضلك اصنع صفحة الويب')).toBe('ar')
    expect(detectLanguage('สวัสดีครับ ช่วยทำหน้านี้ให้หน่อย')).toBe('th')
  })

  it('stays undecided on noise, empty, and tiny input', () => {
    expect(detectLanguage('')).toBeUndefined()
    expect(detectLanguage('OK')).toBeUndefined()
    expect(detectLanguage('123 456 !!!')).toBeUndefined()
  })
})

describe('languageName', () => {
  it('maps known tags to English display names', () => {
    expect(languageName('zh')).toBe('Simplified Chinese')
    expect(languageName('en')).toBe('English')
  })

  it('echoes unknown tags unchanged', () => {
    expect(languageName('xx')).toBe('xx')
  })
})
