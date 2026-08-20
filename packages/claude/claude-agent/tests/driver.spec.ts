/**
 * Claude driver behavior over a scripted SDK stream: transcript projection,
 * resume continuity, error surfacing, and cancellation.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { createUserMessage } from '@voyaseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import type { Session } from '@voyaseek-ai/dsh-session'
import type { CanUseTool, Options, PermissionMode, Query, SDKMessage, Settings } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSdkAgent, restoreClaudeSessionId } from '../src/driver.ts'
import { SdkQueryEngine } from '../src/engine.ts'
import type {} from '../src/types.ts'

/** One scripted SDK exchange captured for assertions. */
interface CapturedQuery {
  prompt: string
  options: Options
}

/** A scripted fake SDK query factory plus its captured inputs. */
class FakeSdk {
  readonly captured: CapturedQuery[] = []
  private scripts: SDKMessage[][] = []
  /** Per-call behavior; tests swap it to hang or fail the next query. */
  impl: (input: CapturedQuery) => Query = input => this.scriptedStream(input)

  /** Queue the message stream the next query call yields. */
  script(messages: SDKMessage[]): void {
    this.scripts.push(messages)
  }

  /** The stable query entry point handed to the engine config. */
  query = (input: { prompt: string; options: Options }): Query => {
    this.captured.push(input)
    return this.impl(input)
  }

  private scriptedStream(_input: CapturedQuery): Query {
    const messages = this.scripts.shift() ?? []
    const stream: AsyncIterable<SDKMessage> = {
      async * [Symbol.asyncIterator]() {
        for (const message of messages) yield message
      },
    }
    return {
      ...stream,
      [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
      close: () => undefined,
      interrupt: async () => undefined,
    } as unknown as Query
  }
}

/** Standard init + success transcript for one assistant reply. */
function successScript(claudeSessionId: string, reply: string): SDKMessage[] {
  return [
    { type: 'system', subtype: 'init', session_id: claudeSessionId, model: 'claude-test' } as unknown as SDKMessage,
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: reply }] },
    } as unknown as SDKMessage,
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: reply,
      session_id: claudeSessionId,
    } as unknown as SDKMessage,
  ]
}

async function makeDriver(
  permissionMode: () => PermissionMode = () => 'bypassPermissions',
  canUseTool?: CanUseTool,
  permissionSettings?: () => Settings['permissions'] | undefined,
  runtime = 'claude',
): Promise<{ ctx: Context; session: Session; driver: ClaudeSdkAgent; sdk: FakeSdk }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('claude-session'), {
    meta: { cwd: '/tmp/claude-work', agentRuntime: runtime },
  })
  const sdk = new FakeSdk()
  const driver = new ClaudeSdkAgent(
    ctx,
    session.id,
    {},
    session,
    () => new SdkQueryEngine({
      childEnv: { PATH: '/usr/bin' },
      permissionMode,
      ...canUseTool === undefined ? {} : { canUseTool },
      ...permissionSettings === undefined ? {} : { permissionSettings },
      disposeGraceMs: 100,
      spawn: () => { throw new Error('unit tests never spawn') },
      query: sdk.query,
    }),
    '/tmp/claude-work',
    'claude-test',
  )
  return { ctx, session, driver, sdk }
}

function sendPrompt(driver: ClaudeSdkAgent, text: string): void {
  driver.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

function eventTypes(session: Session): string[] {
  return session.events.map(event => event.type)
}

describe('ClaudeSdkAgent', () => {
  it('does not resume a Claude provider session inherited across a later runtime switch', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('claude-provider-reset'))
    session.append('claude-agent/runtime', { claudeSessionId: 'claude-old' })
    expect(restoreClaudeSessionId(session)).toBe('claude-old')
    session.append('agent/runtime/switched', { fromRuntime: 'codex', toRuntime: 'claude' })
    expect(restoreClaudeSessionId(session)).toBeUndefined()
    await ctx.fiber.dispose()
  })
  it('projects one successful exchange into the durable transcript', async () => {
    const { session, driver, sdk } = await makeDriver()
    sdk.script(successScript('claude-1', 'hello from claude'))
    sendPrompt(driver, 'do the task')
    await driver.whenIdle()

    expect(sdk.captured).toHaveLength(1)
    expect(sdk.captured[0]!.prompt).toBe('do the task')
    expect(sdk.captured[0]!.options.cwd).toBe('/tmp/claude-work')
    expect(sdk.captured[0]!.options.resume).toBeUndefined()
    expect(sdk.captured[0]!.options.settingSources).toEqual([])

    expect(eventTypes(session)).toEqual([
      'agent/inbox/spliced',
      'turn/start',
      'agent/inbox/spliced',
      'step/start',
      'user/message',
      'request/header',
      'claude-agent/runtime',
      'assistant/message',
      'step/end',
      'turn/end',
    ])
    const assistant = session.events.find(event => event.type === 'assistant/message')
    expect(assistant?.data.message.content).toEqual([{ type: 'text', text: 'hello from claude' }])
    const turnEnd = session.events.find(event => event.type === 'turn/end')
    expect(turnEnd?.data.reason).toEqual({ kind: 'completed' })
    const runtime = session.events.find(event => event.type === 'claude-agent/runtime')
    expect(runtime?.data).toEqual({ claudeSessionId: 'claude-1', model: 'claude-test' })
  })

  it('prepends retained visible history on the first turn after a runtime switch', async () => {
    const { session, driver, sdk } = await makeDriver()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'earlier task' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('agent/runtime/switched', { fromRuntime: 'codex', toRuntime: 'claude' })
    sdk.script(successScript('claude-handoff', 'continued'))

    sendPrompt(driver, 'continue here')
    await driver.whenIdle()

    expect(sdk.captured[0]?.prompt).toContain('[User]\nearlier task')
    expect(sdk.captured[0]?.prompt).toContain('continue here')
    expect(session.events.find(event => event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === '@voyaseek-ai/dsh-agent-loop/runtime-handoff')).toBeDefined()
  })

  it('uses the configured runtime id when matching a cross-runtime handoff', async () => {
    const { session, driver, sdk } = await makeDriver(
      () => 'bypassPermissions',
      undefined,
      undefined,
      'claude-custom',
    )
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'custom runtime history' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('agent/runtime/switched', { fromRuntime: 'native', toRuntime: 'claude-custom' })
    sdk.script(successScript('claude-custom-handoff', 'continued'))

    sendPrompt(driver, 'continue')
    await driver.whenIdle()

    expect(sdk.captured[0]?.prompt).toContain('[User]\ncustom runtime history')
  })

  it('resumes the recorded SDK conversation on later turns', async () => {
    const { session, driver, sdk } = await makeDriver()
    sdk.script(successScript('claude-9', 'first'))
    sendPrompt(driver, 'one')
    await driver.whenIdle()
    sdk.script(successScript('claude-9', 'second'))
    sendPrompt(driver, 'two')
    await driver.whenIdle()

    expect(sdk.captured).toHaveLength(2)
    expect(sdk.captured[0]!.options.resume).toBeUndefined()
    expect(sdk.captured[1]!.options.resume).toBe('claude-9')
    expect(eventTypes(session).filter(type => type === 'turn/start')).toHaveLength(2)
  })

  it('resolves changed session permissions for each query', async () => {
    let permissionMode: PermissionMode = 'default'
    const canUseTool: CanUseTool = async (_toolName, input) => ({ behavior: 'allow', updatedInput: input })
    const { driver, sdk } = await makeDriver(() => permissionMode, canUseTool)
    sdk.script(successScript('claude-permission', 'first'))
    sendPrompt(driver, 'one')
    await driver.whenIdle()

    permissionMode = 'bypassPermissions'
    sdk.script(successScript('claude-permission', 'second'))
    sendPrompt(driver, 'two')
    await driver.whenIdle()

    expect(sdk.captured[0]!.options).toMatchObject({
      permissionMode: 'default',
      canUseTool,
    })
    expect(sdk.captured[0]!.options.allowDangerouslySkipPermissions).toBeUndefined()
    expect(sdk.captured[1]!.options).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      canUseTool,
    })
  })

  it('passes the interaction callback through an explicit bypass override', async () => {
    const canUseTool: CanUseTool = async (_toolName, input) => ({ behavior: 'allow', updatedInput: input })
    const { driver, sdk } = await makeDriver(() => 'bypassPermissions', canUseTool)
    sdk.script(successScript('claude-bypass-question', 'answered'))

    sendPrompt(driver, 'ask me a question')
    await driver.whenIdle()

    expect(sdk.captured[0]!.options).toMatchObject({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      canUseTool,
    })
  })

  it('passes newly remembered session rules to the next query child', async () => {
    const state: { permissions?: Settings['permissions'] } = {}
    const { driver, sdk } = await makeDriver(
      () => 'default',
      async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
      () => state.permissions,
    )
    sdk.script(successScript('claude-permission-settings', 'first'))
    sendPrompt(driver, 'one')
    await driver.whenIdle()

    state.permissions = { allow: ['mcp__browser__open(https://example.com/**)'] }
    sdk.script(successScript('claude-permission-settings', 'second'))
    sendPrompt(driver, 'two')
    await driver.whenIdle()

    expect(sdk.captured[0]!.options.settings).toBeUndefined()
    expect(sdk.captured[1]!.options.settings).toEqual({ permissions: state.permissions })
  })

  it('restores the SDK conversation id from the log on reconstruction', async () => {
    const { session, driver, sdk } = await makeDriver()
    sdk.script(successScript('claude-42', 'seeded'))
    sendPrompt(driver, 'seed')
    await driver.whenIdle()

    // A fresh driver instance over the same session (process restart analogue)
    // must resume the recorded conversation.
    const rebuilt = new ClaudeSdkAgent(
      driver.ctx,
      session.id,
      {},
      session,
      () => new SdkQueryEngine({
        childEnv: { PATH: '/usr/bin' },
        permissionMode: () => 'bypassPermissions',
        disposeGraceMs: 100,
        spawn: () => { throw new Error('unit tests never spawn') },
        query: sdk.query,
      }),
      '/tmp/claude-work',
      'claude-test',
    )
    sdk.script(successScript('claude-42', 'again'))
    sendPrompt(rebuilt, 'next')
    await rebuilt.whenIdle()
    expect(sdk.captured[1]!.options.resume).toBe('claude-42')
  })

  it('records tool exchanges with paired call and result events', async () => {
    const { session, driver, sdk } = await makeDriver()
    sdk.script([
      { type: 'system', subtype: 'init', session_id: 'claude-t' } as unknown as SDKMessage,
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'reading the file' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.txt' } },
          ],
        },
      } as unknown as SDKMessage,
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body', is_error: false }],
        },
      } as unknown as SDKMessage,
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'claude-t',
      } as unknown as SDKMessage,
    ])
    sendPrompt(driver, 'read a.txt')
    await driver.whenIdle()

    const call = session.events.find(event => event.type === 'tool/call')
    expect(call?.data).toMatchObject({ name: 'Read', arguments: JSON.stringify({ file_path: 'a.txt' }) })
    const result = session.events.find(event => event.type === 'tool/result')
    expect(result?.data.message.content[0]).toMatchObject({ type: 'tool-result', isError: false })
    expect(result?.sourceEventSeqs).toEqual([call?.seq])
  })

  it('surfaces an SDK error result as a turn-end error', async () => {
    const { session, driver, sdk } = await makeDriver()
    sdk.script([
      { type: 'system', subtype: 'init', session_id: 'claude-e' } as unknown as SDKMessage,
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['model request failed'],
        session_id: 'claude-e',
      } as unknown as SDKMessage,
    ])
    sendPrompt(driver, 'fail please')
    await driver.whenIdle()
    const turnEnd = session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.data.reason).toMatchObject({ kind: 'error' })
    expect(String((turnEnd?.data as { reason?: { error?: { message?: string } } }).reason?.error?.message))
      .toContain('model request failed')
  })

  it('closes an aborted turn with the cancellation cause', async () => {
    const { session, driver, sdk } = await makeDriver()
    // A stream that hangs until its abort controller fires.
    sdk.impl = (input: CapturedQuery): Query => {
      const signal = input.options.abortController!.signal
      const stream: AsyncIterable<SDKMessage> = {
        async * [Symbol.asyncIterator]() {
          // Hang until the abort controller fires; the rejection ends the drain.
          await new Promise<never>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
            }, { once: true })
          })
        },
      }
      return {
        [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator](),
        close: () => undefined,
        interrupt: async () => undefined,
      } as unknown as Query
    }
    sendPrompt(driver, 'long task')
    expect(driver.status).toBe('running')
    // Let the drain microtask open the turn and hang inside the fake stream.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(sdk.captured).toHaveLength(1)
    driver.cancel({ kind: 'user' })
    await driver.whenIdle()
    expect(driver.status).toBe('idle')
    const turnEnd = session.events.findLast(event => event.type === 'turn/end')
    expect(turnEnd?.data.reason).toEqual({ kind: 'aborted', reason: { kind: 'user' } })
  })
})
