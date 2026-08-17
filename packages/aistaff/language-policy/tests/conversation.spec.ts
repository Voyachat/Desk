import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { MAX_SCANNED_USER_MESSAGES, conversationLanguage } from '../src/conversation.ts'

/** Build a minimal logged user message event for the fold. */
function userMessage(seq: number, text: string, kind: 'user' | 'plugin' = 'user'): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 0,
    data: {
      content: [{ type: 'text', text }],
      source: kind === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'test' },
      role: 'user',
      id: `m${String(seq)}`,
    },
  } as unknown as SessionEvent
}

/** Build a non-user event the fold must skip. */
function turnStart(seq: number): SessionEvent {
  return { type: 'turn/start', seq, time: 0, data: { turn: 1 } } as unknown as SessionEvent
}

describe('conversationLanguage', () => {
  it('returns the newest confident user input language', () => {
    const events = [
      userMessage(1, '帮我做一个网页'),
      turnStart(2),
      userMessage(3, 'please add a login form'),
    ]
    expect(conversationLanguage(events)).toBe('en')
  })

  it('tracks the user switching back to the default language', () => {
    const events = [
      userMessage(1, 'please add a login form'),
      userMessage(2, '好的，再加一个搜索框'),
    ]
    expect(conversationLanguage(events)).toBe('zh')
  })

  it('skips unconfident input and keeps scanning backwards', () => {
    const events = [
      userMessage(1, '帮我做一个网页'),
      userMessage(2, 'OK'),
    ]
    expect(conversationLanguage(events)).toBe('zh')
  })

  it('ignores plugin-authored user messages', () => {
    const events = [
      userMessage(1, '帮我做一个网页'),
      userMessage(2, 'the runtime context changed', 'plugin'),
    ]
    expect(conversationLanguage(events)).toBe('zh')
  })

  it('gives up after the bounded scan window', () => {
    const events: SessionEvent[] = [
      userMessage(0, '帮我做一个网页'),
    ]
    for (let seq = 1; seq <= MAX_SCANNED_USER_MESSAGES; seq += 1) {
      events.push(userMessage(seq, 'OK'))
    }
    expect(conversationLanguage(events)).toBeUndefined()
  })

  it('returns undefined without user messages', () => {
    expect(conversationLanguage([turnStart(1)])).toBeUndefined()
    expect(conversationLanguage([])).toBeUndefined()
  })
})
