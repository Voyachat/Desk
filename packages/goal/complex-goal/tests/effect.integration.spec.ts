import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@voyaseek-ai/cordis'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@voyaseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@voyaseek-ai/dsh-commands'
import SandboxedFileSystem from '@voyaseek-ai/dsh-fs-sandbox'
import GoalService, { GoalId } from '@voyaseek-ai/dsh-goal'
import { createUserMessage } from '@voyaseek-ai/dsh-llm'
import SandboxPolicyService from '@voyaseek-ai/dsh-sandbox-policy'
import { SessionId, type SessionEvent } from '@voyaseek-ai/dsh-session'
import { ShellExecutor } from '@voyaseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellRunResult } from '@voyaseek-ai/dsh-shell'
import SubagentRuntime from '@voyaseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@voyaseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@voyaseek-ai/dsh-subagent-spawn-in-process'
import * as ToolFs from '@voyaseek-ai/dsh-tool-fs'
import ApprovalService from '@voyaseek-ai/dsh-user-approval'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { foldComplexGoal } from '../src/domain.ts'
import * as complexGoal from '../src/index.ts'
import type { ComplexGoalSnapshot } from '../src/types.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

class VerificationShell extends ShellExecutor {
  readonly specs: ShellExecSpec[] = []
  sandboxSupported = true

  constructor(ctx: Context, private readonly config: { readonly deliverable: string }) {
    super(ctx)
  }

  override get sandboxMode() {
    return this.sandboxSupported ? 'workspace-write' as const : undefined
  }

  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 1_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 8_192,
      sandboxPolicy: request.sandboxPolicy,
      ...request.signal === undefined ? {} : { signal: request.signal },
    }
  }

  override async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.specs.push(spec)
    if (spec.command !== 'verify-deliverable') throw new Error(`unexpected verification command ${spec.command}`)
    const passed = await readFile(this.config.deliverable, 'utf8').then(
      value => value === 'VERIFIED',
      () => false,
    )
    return {
      exitCode: passed ? 0 : 1,
      signal: null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: passed ? 'deliverable verified' : '', truncated: false },
      stderr: { text: passed ? '' : 'deliverable missing or invalid', truncated: false },
      sandbox: { mode: 'read-only', denied: false, enforcement: 'full' },
    }
  }

  override start(): never {
    throw new Error('background execution is not available in the verification test')
  }
}

describe('independently verified complex goal over the real spawn stack', () => {
  it('persists the round consumed by a blocking Manager decision', () => {
    const start: ComplexGoalSnapshot = {
      revision: 1,
      goalId: GoalId('manager-blocked-goal'),
      objective: 'Complete the task.',
      startedAtMs: 1,
      deadlineAtMs: 1_001,
      phase: 'planning',
      round: 0,
      maxRounds: 3,
      verificationGates: [],
      verificationOutputMaxBytes: 1_024,
      trustedState: { requirements: [], artifacts: [], facts: [] },
    }
    const blocked: ComplexGoalSnapshot = {
      ...start,
      revision: 2,
      phase: 'blocked',
      round: 1,
      resumeAt: 'planning',
      blocker: 'Required external authority is unavailable.',
    }
    const events: SessionEvent<'complex-goal/change'>[] = [
      {
        type: 'complex-goal/change',
        seq: 0,
        time: 1,
        data: { kind: 'complex-goal/change', version: 2, operation: 'start', snapshot: start },
      },
      {
        type: 'complex-goal/change',
        seq: 1,
        time: 2,
        data: { kind: 'complex-goal/change', version: 2, operation: 'block', snapshot: blocked },
      },
    ]

    expect(foldComplexGoal(events)).toEqual(blocked)
  })

  it('rejects false completion and never runs verification without sandbox support', async () => {
    const workspace = await realpath(await mkdtemp(join(tmpdir(), 'dsh-complex-goal-')))
    const deliverable = join(workspace, 'deliverable.txt')
    const adapter = new MockAdapter([
      toolCallResponse('root-complex-goal', 'complex_goal', {
        objective: 'Create deliverable.txt containing exactly VERIFIED.',
      }),
      toolCallResponse('manager-1', STRUCTURED_OUTPUT_TOOL, {
        route: 'execute',
        task: 'Create deliverable.txt with the exact text VERIFIED.',
        acceptance: ['deliverable.txt exists.', 'Its content is exactly VERIFIED.'],
        blocker: '',
      }),
      toolCallResponse('executor-false-claim', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        summary: 'The deliverable is complete.',
        evidence: ['Claimed that deliverable.txt exists.'],
        blocker: '',
      }),
      toolCallResponse('auditor-read-missing', 'read', { file_path: deliverable }),
      toolCallResponse('auditor-reject', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        integrity: 'clean',
        alignment: 'aligned',
        summary: 'Incorrectly certified the absent artifact.',
        evidence: ['read reported that deliverable.txt does not exist.'],
        missing: [],
        nextTask: '',
        blocker: '',
        verifiedState: {
          requirements: [{
            requirement: 'deliverable.txt contains exactly VERIFIED.',
            status: 'satisfied',
            evidence: ['Incorrect model claim.'],
          }],
          artifacts: [{ artifact: 'deliverable.txt', status: 'verified', evidence: ['Incorrect model claim.'] }],
          facts: ['Incorrectly claimed that the deliverable exists.'],
        },
      }),
      toolCallResponse('manager-2', STRUCTURED_OUTPUT_TOOL, {
        route: 'execute',
        task: 'Create deliverable.txt with the exact text VERIFIED.',
        acceptance: ['deliverable.txt exists.', 'Its content is exactly VERIFIED.'],
        blocker: '',
      }),
      toolCallResponse('executor-write', 'write', { file_path: deliverable, content: 'VERIFIED' }),
      toolCallResponse('executor-report', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        summary: 'Created the required deliverable.',
        evidence: ['Wrote VERIFIED to deliverable.txt.'],
        blocker: '',
      }),
      toolCallResponse('auditor-read-present', 'read', { file_path: deliverable }),
      toolCallResponse('auditor-accept', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        integrity: 'clean',
        alignment: 'aligned',
        summary: 'The required artifact exists with exact content.',
        evidence: ['read returned VERIFIED from deliverable.txt.'],
        missing: [],
        nextTask: '',
        blocker: '',
        verifiedState: {
          requirements: [{
            requirement: 'deliverable.txt contains exactly VERIFIED.',
            status: 'satisfied',
            evidence: ['read returned VERIFIED.'],
          }],
          artifacts: [{ artifact: 'deliverable.txt', status: 'verified', evidence: ['Exact content observed.'] }],
          facts: ['deliverable.txt contains VERIFIED.'],
        },
      }),
      textResponse('The independently verified complex task is complete.'),
    ])

    const ctx = new Context()
    contexts.push(ctx)
    try {
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: workspace })
      await ctx.plugin(VerificationShell, { deliverable })
      await ctx.plugin(SandboxedFileSystem, { cwd: workspace })
      await ctx.plugin(ToolFs)
      await ctx.plugin(ApprovalService)
      await ctx.plugin(CommandRuntime)
      await ctx.plugin(GoalService)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(spawn, { providerName: 'spawn' })
      await ctx.plugin(complexGoal, {
        verificationGates: [{ id: 'artifact', command: 'verify-deliverable', timeoutMs: 2_000 }],
      })
      ctx.llm.registerAdapter(['mock'], adapter)

      const parentHandle = await ctx.agents.create({
        sessionId: SessionId('complex-goal-parent'),
        meta: { cwd: workspace },
        agentOptions: { provider: 'mock', model: 'mock' },
      })
      const children: Agent[] = []
      const phasesBeforeAudit: string[] = []
      const shell = ctx.shell as VerificationShell
      let runsBeforeSandboxEnabled = -1
      shell.sandboxSupported = false
      ctx.on('subagent/start', function (info) {
        const child = ctx.agents.get(info.id)
        if (child !== undefined) children.push(child)
      })
      ctx.on('session/event', (session, event) => {
        if (session !== parentHandle.agent.session || event.type !== 'complex-goal/change') return
        phasesBeforeAudit.push(event.data.snapshot.phase)
        if (event.data.operation === 'audit' && event.data.snapshot.phase === 'planning') {
          runsBeforeSandboxEnabled = shell.specs.length
          shell.sandboxSupported = true
        }
      })

      parentHandle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: '请自主分阶段完成：创建内容严格为 VERIFIED 的 deliverable.txt，并独立验证。' }],
        source: { kind: 'user' },
      }))
      await parentHandle.agent.whenIdle()

      expect(parentHandle.agent.session.events.some(event =>
        event.type === 'tool/call' && event.data.name === 'complex_goal')).toBe(true)
      expect(await readFile(deliverable, 'utf8')).toBe('VERIFIED')
      expect(phasesBeforeAudit).toEqual([
        'planning', 'executing', 'auditing', 'auditing', 'planning',
        'executing', 'auditing', 'auditing', 'complete',
      ])
      const rejectedCertification = parentHandle.agent.session.events.find(event =>
        event.type === 'complex-goal/change'
        && event.data.operation === 'audit'
        && event.data.snapshot.phase === 'planning')
      expect(rejectedCertification?.data.snapshot).toMatchObject({
        latestVerification: { status: 'failed', gates: [{ status: 'runner-failed' }] },
        latestAudit: { status: 'complete', integrity: 'clean', alignment: 'aligned' },
        trustedState: { requirements: [], artifacts: [], facts: [] },
      })
      const state = foldComplexGoal(parentHandle.agent.session.events)
      expect(state).toMatchObject({
        phase: 'complete',
        round: 2,
        latestVerification: { status: 'passed', gates: [{ id: 'artifact', status: 'passed' }] },
        latestAudit: { status: 'complete', integrity: 'clean', alignment: 'aligned' },
      })
      expect(runsBeforeSandboxEnabled).toBe(0)
      expect(shell.specs).toHaveLength(1)
      expect(shell.specs.map(spec => spec.sandboxPolicy?.mode)).toEqual(['read-only'])
      expect(ctx.goals.get(parentHandle.agent)).toMatchObject({ phase: 'complete', activation: 'disarmed' })

      expect(children).toHaveLength(6)
      expect(new Set(children.map(child => child.id)).size).toBe(6)
      for (const child of children) {
        expect(child.session.header.cwd).toBe(workspace)
        expect(child.session.header.seedLength).toBeUndefined()
      }
      const auditors = children.filter(child => child.session.events.some(
        (event): event is SessionEvent<'sandbox/mode'> => event.type === 'sandbox/mode'
          && event.data.mode === 'read-only',
      ))
      expect(auditors).toHaveLength(2)
      for (const auditor of auditors) {
        expect(auditor.session.events.slice(0, 2)).toMatchObject([
          { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
          { type: 'sandbox/mode', data: { mode: 'read-only', source: 'delegation' } },
        ])
      }

      await parentHandle.dispose()
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 30_000)
})
