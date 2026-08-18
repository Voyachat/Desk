import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import Loader from '@voyaseek-ai/cordis-plugin-loader'
import Include from '@voyaseek-ai/cordis-plugin-include'
import { CallId } from '@voyaseek-ai/dsh-llm'
import { Session, SessionId } from '@voyaseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@voyaseek-ai/dsh-agent'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import TerminalSessionService from '@voyaseek-ai/dsh-terminal'
import SandboxProvider from '@voyaseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@voyaseek-ai/dsh-sandbox'
import SandboxPolicyService from '@voyaseek-ai/dsh-sandbox-policy'
import LocalSubprocessRuntime from '@voyaseek-ai/dsh-subprocess-local'
import * as TerminalLocal from '@voyaseek-ai/dsh-terminal-bash'
import * as ToolPty from '@voyaseek-ai/dsh-tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@voyaseek-ai/dsh-agent'",
      "- name: '@voyaseek-ai/dsh-system-prompt'",
      "- name: '@voyaseek-ai/dsh-tools'",
      "- name: '@voyaseek-ai/dsh-terminal'",
      "- name: '@voyaseek-ai/dsh-test-sandbox'",
      "- name: '@voyaseek-ai/dsh-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@voyaseek-ai/dsh-subprocess-local'",
      "- name: '@voyaseek-ai/dsh-terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@voyaseek-ai/dsh-tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@voyaseek-ai/dsh-agent', AgentRegistry],
      ['@voyaseek-ai/dsh-system-prompt', SystemPrompt],
      ['@voyaseek-ai/dsh-tools', ToolRuntime],
      ['@voyaseek-ai/dsh-terminal', TerminalSessionService],
      ['@voyaseek-ai/dsh-test-sandbox', PassthroughSandbox],
      ['@voyaseek-ai/dsh-sandbox-policy', SandboxPolicyService],
      ['@voyaseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
      ['@voyaseek-ai/dsh-terminal-bash', TerminalLocal],
      ['@voyaseek-ai/dsh-tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = agent(context)
    const signal = new AbortController().signal
    const spawn = await context.tools.execute({
      signal, callId: CallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await context.tools.execute({
      signal, callId: CallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await context.tools.execute({
      signal, callId: CallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
