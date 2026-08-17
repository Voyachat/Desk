import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkerThreadWorkflowEngine from '@deepseek-ai/dsh-workflow-worker-thread'
import * as ToolWorkflow from '../src/index.ts'

const contexts: Context[] = []
let fixtureRoot: string | undefined

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
})

/** Boot the production workflow roles through a real Loader tree. */
async function bootLoader(): Promise<Context> {
  if (fixtureRoot === undefined) {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-workflow-recovery-loader-'))
    await writeFile(join(fixtureRoot, 'cordis.yml'), [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-subagent'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-workflow-worker-thread'",
      '  config:',
      '    provider: spawn',
      '    disposeGraceMs: 30',
      "- name: '@deepseek-ai/dsh-tool-workflow'",
      '',
    ].join('\n'))
  }

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(fixtureRoot).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-commands', CommandRuntime],
    ['@deepseek-ai/dsh-workflow-worker-thread', WorkerThreadWorkflowEngine],
    ['@deepseek-ai/dsh-tool-workflow', ToolWorkflow],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(join(fixtureRoot, 'cordis.yml')).href },
  })
  await ctx.loader.await()
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: (request) => {
      const terminal = Promise.withResolvers<SubagentResult>()
      const abort = (): void => {
        terminal.resolve({ output: [], stopReason: 'aborted' })
      }
      request.signal.addEventListener('abort', abort, { once: true })
      return Promise.resolve({
        id: SessionId('loader-workflow-child'),
        localAgent: undefined,
        result: terminal.promise,
        dispose: () => {
          request.signal.removeEventListener('abort', abort)
          terminal.resolve({ output: [], stopReason: 'aborted' })
          return Promise.resolve()
        },
      })
    },
  })
  return ctx
}

describe('real Loader and worker-thread recovery', () => {
  it('replays an open persisted prefix into a new process and closes it as interrupted', { timeout: 30_000 }, async () => {
    const first = await bootLoader()
    const session = Session.create(SessionId('loader-workflow-recovery'))
    const parent = { id: session.id, options: {}, session } as unknown as Agent
    const callId = CallId('call-before-crash')
    const args = {
      script: "return await agent('park until restart', { label: 'worker', phase: 'Scan' })",
      meta: { name: 'crash-recovery', description: 'keep one real worker member open' },
    }
    session.append('tool/call', {
      turn: 1, step: 1, callId, name: 'workflow', arguments: JSON.stringify(args),
    })
    const controller = new AbortController()
    const running = first.tools.execute({
      signal: controller.signal,
      callId,
      name: 'workflow',
      arguments: args,
      agent: parent,
    })
    // The real worker thread and the subagent round trip must both start
    // before the crash snapshot; the default 1s waitFor budget flakes under
    // aggregate-gate contention, so the wait carries the test's own slack.
    await vi.waitFor(() => {
      expect(session.events.some(event => event.type === 'tool-workflow/run-start')).toBe(true)
      expect(session.events.some(event => event.type === 'tool-workflow/agent-start')).toBe(true)
    }, { timeout: 15_000 })
    expect(session.events.some(event => event.type === 'tool-workflow/run-end')).toBe(false)

    const persistedPrefix = session.events
    const resumedSession = Session.create(session.id, persistedPrefix, session.header)
    const second = await bootLoader()
    const resumedAgent = {
      id: resumedSession.id, options: {}, session: resumedSession,
    } as unknown as Agent
    agentEvents(second, resumedAgent).emit('agent/session-start', { source: 'resume' })

    expect(resumedSession.events.slice(-3).map(event => [event.type, event.data])).toEqual([
      ['session/end-seed', {}],
      ['tool-workflow/agent-end', expect.objectContaining({ outcome: 'interrupted' })],
      ['tool-workflow/run-end', expect.objectContaining({ stopReason: 'interrupted' })],
    ])
    expect(second.commands.list(resumedAgent)).toContainEqual({
      name: 'workflow-retry',
      description: 'restart an interrupted or failed workflow from its logged source call',
      input: { hint: '<runId>' },
    })

    controller.abort('test cleanup after the crash snapshot')
    await expect(running).resolves.toMatchObject({ isError: true })
  })
})
