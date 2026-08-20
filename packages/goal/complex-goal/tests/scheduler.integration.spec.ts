import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import AgentDefaultModel from '@voyaseek-ai/dsh-agent-default-model'
import AgentLoop from '@voyaseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@voyaseek-ai/dsh-agent-loop-testkit'
import CommandRuntime from '@voyaseek-ai/dsh-commands'
import GoalService from '@voyaseek-ai/dsh-goal'
import SandboxPolicyService from '@voyaseek-ai/dsh-sandbox-policy'
import { SessionId } from '@voyaseek-ai/dsh-session'
import JsonlSessionPersistence from '@voyaseek-ai/dsh-session-persistence-jsonl'
import { ShellExecutor } from '@voyaseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec } from '@voyaseek-ai/dsh-shell'
import SubagentRuntime from '@voyaseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@voyaseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@voyaseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService from '@voyaseek-ai/dsh-user-approval'
import { maxTokensResponse, MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { foldComplexGoal } from '../src/domain.ts'
import * as complexGoal from '../src/index.ts'
import type { ComplexGoalSnapshot } from '../src/types.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

class UnusedShell extends ShellExecutor {
  override resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 1_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 1_024,
      sandboxPolicy: request.sandboxPolicy,
      ...request.signal === undefined ? {} : { signal: request.signal },
    }
  }

  override run(): never {
    throw new Error('scheduler fixture does not run verification commands')
  }

  override start(): never {
    throw new Error('scheduler fixture does not start shell processes')
  }
}

async function mount(
  persistenceRoot: string,
  adapter: MockAdapter,
  options: { readonly automaticResume: boolean; readonly retryInitialDelayMs?: number },
): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentDefaultModel, { provider: 'mock', model: 'mock' })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: persistenceRoot })
  await ctx.plugin(UnusedShell)
  await ctx.plugin(ApprovalService)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(spawn, { providerName: 'spawn' })
  await ctx.plugin(complexGoal, {
    automaticResume: options.automaticResume,
    schedulerPollIntervalMs: 250,
    retryInitialDelayMs: options.retryInitialDelayMs ?? 2_000,
    retryMaxDelayMs: options.retryInitialDelayMs ?? 2_000,
    maxRecoveryAttempts: 3,
  })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

async function seedPausedGoal(
  ctx: Context,
  cwd: string,
  sessionId: SessionId,
  dispose = true,
  beforeFlush?: (agent: Agent) => void,
): Promise<Agent> {
  const handle = await ctx.agents.create({
    sessionId,
    meta: { cwd },
    agentOptions: { provider: 'mock', model: 'mock' },
  })
  const goal = ctx.goals.create(handle.agent, { objective: 'Finish the durable task.' })
  ctx.goals.disarm(handle.agent)
  const startedAtMs = Date.now()
  const start: ComplexGoalSnapshot = {
    revision: 1,
    goalId: goal.id,
    objective: goal.objective,
    startedAtMs,
    deadlineAtMs: startedAtMs + 60_000,
    phase: 'planning',
    round: 0,
    maxRounds: goal.maxGoalRounds,
    workspace: { kind: 'shared', sourceCwd: cwd, taskCwd: cwd, reason: 'disabled' },
    verificationGates: [],
    verificationOutputMaxBytes: 1_024,
    trustedState: { requirements: [], artifacts: [], facts: [] },
  }
  const paused: ComplexGoalSnapshot = {
    ...start,
    revision: 2,
    phase: 'paused',
    resumeAt: 'planning',
  }
  handle.agent.session.append('complex-goal/change', {
    kind: 'complex-goal/change', version: 3, operation: 'start', snapshot: start,
  })
  handle.agent.session.append('complex-goal/change', {
    kind: 'complex-goal/change', version: 3, operation: 'interrupt', snapshot: paused,
  })
  beforeFlush?.(handle.agent)
  await ctx.sessions.flush(handle.agent.session)
  if (dispose) await handle.dispose()
  return handle.agent
}

describe('durable complex-goal scheduler', () => {
  it('reconciles a paused goal while its owning Agent remains live', { timeout: 10_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-complex-live-scheduler-')))
    roots.push(root)
    const sessions = join(root, 'sessions')
    const sessionId = SessionId('live-complex-goal')
    const ctx = await mount(sessions, new MockAdapter([
      toolCallResponse('manager-blocked-live', STRUCTURED_OUTPUT_TOOL, {
        route: 'blocked',
        task: '',
        acceptance: [],
        blocker: 'A live external authority is required.',
      }),
    ]), { automaticResume: true })

    await seedPausedGoal(ctx, root, sessionId, false)

    await vi.waitFor(async () => {
      const inspected = await ctx.sessionPersistence.inspect(sessionId)
      expect(foldComplexGoal(inspected.events)).toMatchObject({
        phase: 'blocked',
        blocker: 'A live external authority is required.',
      })
    }, { timeout: 5_000 })
  })

  it('does not count a lost idle claim as a durable recovery failure', { timeout: 10_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-complex-claim-race-')))
    roots.push(root)
    const sessions = join(root, 'sessions')
    const sessionId = SessionId('claim-race-complex-goal')
    const ctx = await mount(sessions, new MockAdapter([]), { automaticResume: true })
    const claim = vi.fn()
    await seedPausedGoal(ctx, root, sessionId, false, (agent) => {
      vi.spyOn(agent, 'runMaintenance').mockImplementationOnce(() => {
        claim()
        throw new Error(`agent "${agent.id}" already has active work`)
      })
    })

    await vi.waitFor(() => expect(claim).toHaveBeenCalled(), { timeout: 5_000, interval: 5 })
    const inspected = await ctx.sessionPersistence.inspect(sessionId)
    expect(foldComplexGoal(inspected.events)).toMatchObject({ phase: 'paused', revision: 2 })
    expect(inspected.events.flatMap(event => event.type === 'complex-goal/change' ? [event.data.operation] : []))
      .not.toContain('retry')
  })

  it('does not attribute an old maintenance error to a concurrently advanced goal', { timeout: 10_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-complex-generation-race-')))
    roots.push(root)
    const sessions = join(root, 'sessions')
    const sessionId = SessionId('generation-race-complex-goal')
    const ctx = await mount(sessions, new MockAdapter([
      maxTokensResponse('manager stopped before a structured decision'),
    ]), { automaticResume: true })
    const claim = vi.fn()
    await seedPausedGoal(ctx, root, sessionId, false, (agent) => {
      const runMaintenance = agent.runMaintenance.bind(agent)
      vi.spyOn(agent, 'runMaintenance').mockImplementationOnce(job => {
        claim()
        return runMaintenance(job).catch(async error => {
          const current = foldComplexGoal(agent.session.events)
          expect(current).toMatchObject({ phase: 'paused' })
          if (current === undefined) throw new Error('missing complex-goal checkpoint')
          const superseded: ComplexGoalSnapshot = {
            ...current,
            revision: current.revision + 1,
            phase: 'blocked',
            blocker: 'A concurrent owner advanced the goal after claiming idle.',
          }
          agent.session.append('complex-goal/change', {
            kind: 'complex-goal/change', version: 3, operation: 'block', snapshot: superseded,
          })
          await ctx.sessions.flush(agent.session)
          throw error
        })
      })
    })

    await vi.waitFor(() => expect(claim).toHaveBeenCalled(), { timeout: 5_000, interval: 5 })

    await vi.waitFor(async () => {
      const inspected = await ctx.sessionPersistence.inspect(sessionId)
      expect(foldComplexGoal(inspected.events)).toMatchObject({
        phase: 'blocked',
        blocker: 'A concurrent owner advanced the goal after claiming idle.',
      })
    }, { timeout: 5_000 })
    const inspected = await ctx.sessionPersistence.inspect(sessionId)
    expect(inspected.events.flatMap(event => event.type === 'complex-goal/change' ? [event.data.operation] : []))
      .not.toContain('retry')
  })

  it('persists retry timing and finishes reconciliation after another process restart', { timeout: 15_000 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-complex-scheduler-')))
    roots.push(root)
    const sessions = join(root, 'sessions')
    const sessionId = SessionId('durable-complex-goal')

    const seed = await mount(sessions, new MockAdapter([]), { automaticResume: false })
    await seedPausedGoal(seed, root, sessionId)
    await seed.fiber.dispose()
    contexts.splice(contexts.indexOf(seed), 1)

    const failing = await mount(sessions, new MockAdapter([
      maxTokensResponse('manager stopped before a structured decision'),
    ]), { automaticResume: true, retryInitialDelayMs: 2_000 })
    await vi.waitFor(async () => {
      const inspected = await failing.sessionPersistence.inspect(sessionId)
      expect(foldComplexGoal(inspected.events)).toMatchObject({
        phase: 'paused',
        recovery: { attempt: 1, lastError: expect.stringContaining('max-tokens') },
      })
    }, { timeout: 5_000 })
    await failing.fiber.dispose()
    contexts.splice(contexts.indexOf(failing), 1)

    const completing = await mount(sessions, new MockAdapter([
      toolCallResponse('manager-blocked-after-restart', STRUCTURED_OUTPUT_TOOL, {
        route: 'blocked',
        task: '',
        acceptance: [],
        blocker: 'A real external authority is required.',
      }),
    ]), { automaticResume: true, retryInitialDelayMs: 2_000 })
    await vi.waitFor(async () => {
      const inspected = await completing.sessionPersistence.inspect(sessionId)
      expect(foldComplexGoal(inspected.events)).toMatchObject({
        phase: 'blocked',
        blocker: 'A real external authority is required.',
      })
    }, { timeout: 7_000 })

    const inspected = await completing.sessionPersistence.inspect(sessionId)
    const operations = inspected.events.flatMap(event => event.type === 'complex-goal/change'
      ? [event.data.operation]
      : [])
    expect(operations).toContain('retry')
    expect(operations.filter(operation => operation === 'resume')).toHaveLength(2)
  })
})
