import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { createAssistantMessage, createUserMessage } from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import { RuntimeContextProjection, runtimeHandoffMessage } from '../src/runtime-context.ts'

const SOURCE = '@voyaseek-ai/dsh-system-prompt'

function contextMessage(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: SOURCE },
  })
}

describe('RuntimeContextProjection', () => {
  it('restores the latest visible owned snapshot and ignores other sessions', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-context-replay'))
    const retained = session.append('user/message', contextMessage('retained'), { surfaceOp: 'append' })
    const shadowed = session.append('user/message', contextMessage('shadowed'), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'summary' }],
      source: { kind: 'plugin', plugin: 'test-compaction' },
    }), {
      surfaceOp: { op: 'replace', start: shadowed.seq, end: shadowed.seq },
      sourceEventSeqs: [shadowed.seq],
    })

    const projection = new RuntimeContextProjection(ctx, session)
    expect(session.surface.nodes).toContain(retained.seq)
    expect(projection.project('retained', [])).toBeUndefined()
    expect(projection.project('next', [{ name: 'sandbox:policy', text: 'policy' }])?.source).toEqual({
      kind: 'plugin',
      plugin: SOURCE,
      form: 'snapshot',
      sections: [{ name: 'sandbox:policy', text: 'policy' }],
    })

    const other = ctx.sessions.create(SessionId('runtime-context-other'))
    other.append('user/message', contextMessage('other'), { surfaceOp: 'append' })
    expect(projection.project('retained', [])).toBeUndefined()
  })
})

describe('runtimeHandoffMessage', () => {
  it('renders visible history as user-level recall and omits private reasoning and stale plugin context', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-handoff'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'keep user text' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', contextMessage('stale runtime context'), { surfaceOp: 'append' })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        content: [
          { type: 'reasoning', text: 'private reasoning' },
          { type: 'text', text: 'keep assistant text' },
        ],
        source: { provider: 'test', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
    session.append('agent/runtime/switched', { toRuntime: 'codex' })

    const handoff = runtimeHandoffMessage(session, 'codex', 'request/context')

    expect(handoff?.source).toEqual({
      kind: 'plugin', plugin: '@voyaseek-ai/dsh-agent-loop/runtime-handoff', form: 'recall',
    })
    const text = handoff?.content[0]?.type === 'text' ? handoff.content[0].text : ''
    expect(text).toContain('[User]\nkeep user text')
    expect(text).toContain('[Assistant]\nkeep assistant text')
    expect(text).not.toContain('private reasoning')
    expect(text).not.toContain('stale runtime context')
    await ctx.fiber.dispose()
  })

  it('does not repeat a handoff after the target runtime has durable continuation state', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-handoff-resumed'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'history' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('agent/runtime/switched', { toRuntime: 'claude' })
    session.append('request/context', { provider: 'test', model: 'test' })
    expect(runtimeHandoffMessage(session, 'claude', 'request/context')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('omits dynamic memory recall and bounds the complete handoff by tokens and UTF-8 bytes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('runtime-handoff-bounded'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'stale recalled memory' }],
      source: { kind: 'agent-memory', form: 'recall', items: [] } as never,
    }), { surfaceOp: 'append' })
    for (let index = 0; index < 12; index += 1) {
      session.append('assistant/message', {
        turn: index + 1,
        step: 1,
        message: createAssistantMessage({
          content: [{
            type: 'text',
            text: `${String(index)}:${index % 2 === 0 ? 'x'.repeat(10_000) : '记'.repeat(10_000)}`,
          }],
          source: { provider: 'test', model: 'test-model' },
        }),
      }, { surfaceOp: 'append' })
    }
    session.append('agent/runtime/switched', { toRuntime: 'codex' })

    const handoff = runtimeHandoffMessage(session, 'codex', 'request/context')
    const text = handoff?.content[0]?.type === 'text' ? handoff.content[0].text : ''
    expect(text).toContain('original prompt')
    expect(text).not.toContain('stale recalled memory')
    expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(16_000)
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(64_000)
    expect(text).toContain('Earlier conversation omitted')
    await ctx.fiber.dispose()
  })
})
