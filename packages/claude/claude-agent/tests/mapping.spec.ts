/**
 * Recorder projection edges: unknown messages, block filtering, and result
 * text extraction.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { SdkEventRecorder, resultText } from '../src/mapping.ts'
import type {} from '../src/types.ts'

async function openStep(): Promise<Session> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('mapping-session'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  return session
}

describe('resultText', () => {
  it('keeps string payloads verbatim', () => {
    expect(resultText('plain output')).toBe('plain output')
  })

  it('joins text blocks of array payloads', () => {
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
  })

  it('returns empty for foreign payloads', () => {
    expect(resultText(undefined)).toBe('')
    expect(resultText(42)).toBe('')
  })
})

describe('SdkEventRecorder', () => {
  it('skips control-plane and unknown messages', async () => {
    const session = await openStep()
    const recorder = new SdkEventRecorder(session, 1, 1, 'claude-test')
    recorder.apply({ type: 'status', status: 'working' } as unknown as SDKMessage)
    recorder.apply({ type: 'stream_event' } as unknown as SDKMessage)
    expect(session.events.map(event => event.type)).toEqual(['turn/start', 'step/start'])
  })

  it('drops assistant messages without transcript blocks', async () => {
    const session = await openStep()
    const recorder = new SdkEventRecorder(session, 1, 1, 'claude-test')
    recorder.apply({
      type: 'assistant',
      message: { content: [{ type: 'server_tool_use' }, { type: 'text' }] },
    } as unknown as SDKMessage)
    expect(session.events.some(event => event.type === 'assistant/message')).toBe(false)
  })

  it('keeps valid blocks and filters malformed siblings', async () => {
    const session = await openStep()
    const recorder = new SdkEventRecorder(session, 1, 1, 'claude-test')
    recorder.apply({
      type: 'assistant',
      message: { content: [{ type: 'text' }, { type: 'text', text: 'kept' }, { type: 'thinking' }] },
    } as unknown as SDKMessage)
    const assistant = session.events.findLast(event => event.type === 'assistant/message')
    expect(assistant?.data.message.content).toEqual([{ type: 'text', text: 'kept' }])
  })

  it('records tool results without a matching call when the SDK skips one', async () => {
    const session = await openStep()
    const recorder = new SdkEventRecorder(session, 1, 1, 'claude-test')
    recorder.apply({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_missing', content: 'late result' }] },
    } as unknown as SDKMessage)
    const result = session.events.findLast(event => event.type === 'tool/result')
    expect(result?.sourceEventSeqs).toBeUndefined()
    expect(result?.data.message.content[0]).toMatchObject({ isError: false })
  })

  it('reports the SDK conversation id through the session callback', async () => {
    const session = await openStep()
    const seen: { id: string; model?: string }[] = []
    const recorder = new SdkEventRecorder(session, 1, 1, 'claude-test', (id, model) => {
      seen.push(model === undefined ? { id } : { id, model })
    })
    recorder.apply({
      type: 'system',
      subtype: 'init',
      session_id: 'claude-77',
      model: 'claude-opus',
    } as unknown as SDKMessage)
    // Non-init system messages stay unreported.
    recorder.apply({
      type: 'system',
      subtype: 'status',
      session_id: 'claude-ignored',
    } as unknown as SDKMessage)
    expect(seen).toEqual([{ id: 'claude-77', model: 'claude-opus' }])
  })
})
