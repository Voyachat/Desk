/**
 * Semantically selected or command-started complex goals with fresh Manager,
 * Executor, and read-only Auditor children. The existing goal log owns the
 * objective lifecycle; this plugin adds deterministic evidence and independently
 * verified round state without changing agent-loop.
 * @module @voyaseek-ai/dsh-complex-goal
 */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@voyaseek-ai/dsh-commands'
import type { GoalRef, GoalView } from '@voyaseek-ai/dsh-goal'
import type { ContentBlock } from '@voyaseek-ai/dsh-llm'
import type { SessionId } from '@voyaseek-ai/dsh-session'
import type { ShellRunResult } from '@voyaseek-ai/dsh-shell'
import type { ResolvedSubagentStartRequest, SubagentProvider, SubagentResult } from '@voyaseek-ai/dsh-subagent'
import { startInProcessRun } from '@voyaseek-ai/dsh-subagent-in-process-driver'
import { deadline, MAX_TIMER_DELAY_MS, timeoutOf } from '@voyaseek-ai/dsh-timeout'
import { goalToolExecution, requireDirectHuman } from '@voyaseek-ai/dsh-tool-goal'
import { defineTool } from '@voyaseek-ai/dsh-tools'
import type { GenericCallView, ObjectJsonSchema, ToolRestriction } from '@voyaseek-ai/dsh-tools'
import type {} from '@voyaseek-ai/dsh-sandbox-policy'
import type {} from '@voyaseek-ai/dsh-system-prompt'
import type {} from '@voyaseek-ai/dsh-user-approval'
import {
  COMPLEX_GOAL_CHANGE_VERSION,
  decodeAudit,
  decodeExecution,
  emptyVerifiedState,
  foldComplexGoal,
} from './domain.ts'
import type {
  ComplexGoalChange,
  ComplexGoalContract,
  ComplexGoalExecution,
  ComplexGoalOperation,
  ComplexGoalSnapshot,
  ComplexGoalVerification,
  ComplexGoalVerificationGate,
  ComplexGoalVerificationGateResult,
} from './types.ts'

export type * from './types.ts'
export {
  COMPLEX_GOAL_CHANGE_VERSION,
  decodeComplexGoalChange,
  foldComplexGoal,
} from './domain.ts'

export const name = 'complex-goal'
export const inject = [
  'agents',
  'commands',
  'goals',
  'sessions',
  'shell',
  'subagents',
  'tools',
  'sandboxPolicy',
  'approval',
  'systemPrompt',
]

const COMMAND_NAME = 'goal-complex'
const AUDITOR_PROVIDER = 'complex-goal-auditor'
const USAGE = 'Usage: /goal-complex [<objective>|resume]'
const TIME_LIMIT_CODE = 'COMPLEX_GOAL_TIME_LIMIT'
const DEFAULT_VERIFICATION_TIMEOUT_MS = 120_000
const DEFAULT_VERIFICATION_OUTPUT_MAX_BYTES = 8_192
const DEFAULT_MAX_DURATION_MS = 3_600_000
const MAX_VERIFICATION_OUTPUT_BYTES = 65_536
const MAX_VERIFICATION_GATES = 32

/** One trusted deployment command used as a deterministic completion gate. */
export interface VerificationGateConfig {
  /** Stable identifier rendered in durable evidence. */
  id: string
  /** Exact command; model output can never replace or extend it. */
  command: string
  /** Per-command timeout override. */
  timeoutMs?: number
}

/** Deployment policy for independently verified complex tasks. */
export interface Config {
  /** Ordered commands that must all pass before completion is certifiable. */
  verificationGates?: VerificationGateConfig[]
  /** Default timeout for a verification command. */
  verificationTimeoutMs?: number
  /** Maximum stdout or stderr bytes persisted for each command. */
  verificationOutputMaxBytes?: number
  /** Total wall-clock lifetime retained across pause and process restart. */
  maxDurationMs?: number
}

/** Schemastery configuration for deterministic verification and the total budget. */
export const Config: z<Config> = z.object({
  verificationGates: z.array(z.object({
    id: z.string().required(),
    command: z.string().required(),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
  })).default([]),
  verificationTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS)
    .default(DEFAULT_VERIFICATION_TIMEOUT_MS),
  verificationOutputMaxBytes: z.number().step(1).min(1).max(MAX_VERIFICATION_OUTPUT_BYTES)
    .default(DEFAULT_VERIFICATION_OUTPUT_MAX_BYTES),
  maxDurationMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DURATION_MS),
})

interface ResolvedConfig {
  readonly verificationGates: readonly ComplexGoalVerificationGate[]
  readonly verificationOutputMaxBytes: number
  readonly maxDurationMs: number
}

const MANAGER_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    route: { type: 'string', enum: ['execute', 'audit', 'blocked'] },
    task: { type: 'string' },
    acceptance: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['route', 'task', 'acceptance', 'blocker'],
}

const EXECUTOR_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['complete', 'continue', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    blocker: { type: 'string' },
  },
  required: ['status', 'summary', 'evidence', 'blocker'],
}

const VERIFIED_REQUIREMENT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    requirement: { type: 'string' },
    status: { type: 'string', enum: ['satisfied', 'pending', 'blocked'] },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['requirement', 'status', 'evidence'],
}

const VERIFIED_ARTIFACT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    artifact: { type: 'string' },
    status: { type: 'string', enum: ['verified', 'missing', 'suspect'] },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['artifact', 'status', 'evidence'],
}

const AUDITOR_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['complete', 'continue', 'blocked'] },
    integrity: { type: 'string', enum: ['clean', 'suspect', 'violation'] },
    alignment: { type: 'string', enum: ['aligned', 'partial', 'misaligned'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    nextTask: { type: 'string' },
    blocker: { type: 'string' },
    verifiedState: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requirements: { type: 'array', items: VERIFIED_REQUIREMENT_SCHEMA },
        artifacts: { type: 'array', items: VERIFIED_ARTIFACT_SCHEMA },
        facts: { type: 'array', items: { type: 'string' } },
      },
      required: ['requirements', 'artifacts', 'facts'],
    },
  },
  required: [
    'status', 'integrity', 'alignment', 'summary', 'evidence', 'missing',
    'nextTask', 'blocker', 'verifiedState',
  ],
}

interface ManagerDecision {
  readonly route: 'execute' | 'audit' | 'blocked'
  readonly contract?: ComplexGoalContract
  readonly blocker: string
}

interface ActiveRun {
  readonly controller: AbortController
  done: Promise<unknown>
}

/** Fresh in-process provider whose child receives a final read-only override before publication. */
class ReadOnlyAuditorProvider implements SubagentProvider {
  readonly name = AUDITOR_PROVIDER
  readonly capabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly inheritsParentContext = false

  start(request: ResolvedSubagentStartRequest) {
    return startInProcessRun(request, {
      setup(childCtx) {
        const child = childCtx.agent as Agent
        child.session.append('sandbox/mode', { mode: 'read-only', source: 'delegation' })
      },
    })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value !== value.trim() || (!allowEmpty && value.length === 0)) {
    throw new Error(`${field} must be ${allowEmpty ? 'normalized' : 'non-empty and normalized'}`)
  }
  return value
}

function normalizedList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, index) => normalizedText(item, `${field}[${index}]`))
}

function positiveInteger(value: number, field: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${field} must be a positive safe integer no greater than ${max}`)
  }
  return value
}

/** Validate config even when a caller bypasses Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  const verificationTimeoutMs = positiveInteger(
    config.verificationTimeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
    'verificationTimeoutMs',
    MAX_TIMER_DELAY_MS,
  )
  const verificationOutputMaxBytes = positiveInteger(
    config.verificationOutputMaxBytes ?? DEFAULT_VERIFICATION_OUTPUT_MAX_BYTES,
    'verificationOutputMaxBytes',
    MAX_VERIFICATION_OUTPUT_BYTES,
  )
  const maxDurationMs = positiveInteger(
    config.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
    'maxDurationMs',
    MAX_TIMER_DELAY_MS,
  )
  const configured = config.verificationGates ?? []
  if (configured.length > MAX_VERIFICATION_GATES) {
    throw new TypeError(`verificationGates must contain at most ${MAX_VERIFICATION_GATES} entries`)
  }
  const ids = new Set<string>()
  const verificationGates = configured.map((gate, index): ComplexGoalVerificationGate => {
    const id = normalizedText(gate.id, `verificationGates[${index}].id`)
    if (!/^[a-z0-9][a-z0-9._-]*$/u.test(id)) {
      throw new TypeError(`verificationGates[${index}].id must use lowercase letters, digits, dot, underscore, or hyphen`)
    }
    if (ids.has(id)) throw new TypeError(`verificationGates contains duplicate id ${JSON.stringify(id)}`)
    ids.add(id)
    return {
      id,
      command: normalizedText(gate.command, `verificationGates[${index}].command`),
      timeoutMs: positiveInteger(
        gate.timeoutMs ?? verificationTimeoutMs,
        `verificationGates[${index}].timeoutMs`,
        MAX_TIMER_DELAY_MS,
      ),
    }
  })
  return { verificationGates, verificationOutputMaxBytes, maxDurationMs }
}

function decodeManager(value: unknown): ManagerDecision {
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== 'acceptance,blocker,route,task') {
    throw new Error('complex goal Manager returned a malformed decision')
  }
  const route = value['route']
  if (route !== 'execute' && route !== 'audit' && route !== 'blocked') {
    throw new Error('complex goal Manager route is invalid')
  }
  const task = normalizedText(value['task'], 'Manager task', route === 'blocked')
  const acceptance = normalizedList(value['acceptance'], 'Manager acceptance')
  const blocker = normalizedText(value['blocker'], 'Manager blocker', route !== 'blocked')
  if (route === 'blocked') {
    if (blocker.length === 0) throw new Error('blocked Manager decision requires blocker')
    return { route, blocker }
  }
  if (acceptance.length === 0) throw new Error('Manager contract requires acceptance checks')
  if (blocker.length !== 0) throw new Error('non-blocked Manager decision requires an empty blocker')
  return { route, contract: { task, acceptance }, blocker }
}

function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

function prompt(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** Only tools whose shipped operations are observational may reach the Auditor. */
function auditorToolFilter(ctx: Context, parent: Agent): ToolRestriction {
  const candidates = [
    'read', 'read_image', 'glob', 'grep', 'web_search',
    'session_event_read', 'session_event_search', 'session_event_trace', 'session_search', 'session_trace',
  ]
  return { allow: candidates.filter(name => ctx.tools.get(name, parent) !== undefined) }
}

/** Prevent the Executor from recursively starting another orchestrator or mutating the root goal. */
function executorToolFilter(ctx: Context, parent: Agent): ToolRestriction | undefined {
  const candidates = ['complex_goal', 'ralph', 'workflow', 'subagent', 'subagent_fork', 'create_goal', 'update_goal']
  const deny = candidates.filter(name => ctx.tools.get(name, parent) !== undefined)
  return deny.length === 0 ? undefined : { deny }
}

function managerPrompt(snapshot: ComplexGoalSnapshot, round: number): string {
  return [
    'You are the Manager for an independently verified complex task. You cannot inspect or modify the environment and must not claim that work is complete.',
    `Immutable objective:\n${snapshot.objective}`,
    `Round: ${round} of ${snapshot.maxRounds}.`,
    `Auditor-verified state from the previous round:\n${json(snapshot.trustedState)}`,
    snapshot.latestAudit === undefined ? 'Previous audit: none.' : `Previous audit:\n${json(snapshot.latestAudit)}`,
    snapshot.latestVerification === undefined
      ? 'Previous deterministic verification: none.'
      : `Previous deterministic verification:\n${json(snapshot.latestVerification)}`,
    'Select exactly one bounded next task with concrete acceptance checks. Use route audit when the environment may already satisfy the objective or the previous execution outcome is unknown. Use blocked only when no safe local progress remains.',
    'Return normalized strings. blocker is non-empty only for blocked; task and acceptance are non-empty for execute or audit.',
  ].join('\n\n')
}

function executorPrompt(snapshot: ComplexGoalSnapshot): string {
  return [
    'You are the fresh Executor for one bounded task. Inspect the current workspace, perform only this task, and verify your own work. Your report is an untrusted claim until a separate Auditor checks the environment.',
    `Immutable objective:\n${snapshot.objective}`,
    `Auditor-verified state:\n${json(snapshot.trustedState)}`,
    `Bounded contract:\n${json(snapshot.contract)}`,
    'Return complete only when this bounded contract appears satisfied, continue when useful work remains, or blocked with a concrete blocker. blocker must be empty unless blocked.',
  ].join('\n\n')
}

function auditorPrompt(snapshot: ComplexGoalSnapshot): string {
  const execution = snapshot.latestExecution === undefined
    ? 'No trustworthy Executor result is available; the execution outcome is unknown. Inspect the environment directly.'
    : `Executor claims (untrusted; verify independently):\n${json(snapshot.latestExecution)}`
  const verification = snapshot.verificationGates.length === 0
    ? 'No deployment-owned deterministic verification gates are configured for this goal.'
    : `Deployment-owned deterministic verification (authoritative; every gate must pass before complete):\n${json(snapshot.latestVerification)}`
  return [
    'You are the fresh read-only Auditor. Do not modify the workspace, run mutating operations, or repair failures. Derive the objective acceptance requirements yourself, inspect authoritative environment state, and treat every Executor statement as an untrusted claim.',
    `Immutable objective:\n${snapshot.objective}`,
    `Previous Auditor-verified state:\n${json(snapshot.trustedState)}`,
    `Current bounded contract:\n${json(snapshot.contract)}`,
    execution,
    verification,
    'Return status complete only when the full objective is proven, integrity clean, alignment aligned, evidence is non-empty, and missing is empty. Return continue with a concrete nextTask while verifiable work remains. Return blocked only for a concrete external or permission blocker. integrity violation records evidence of unsafe or misleading state and blocks completion.',
    'verifiedState is the complete state that the next round may trust: requirements, artifacts, and facts must cite only evidence you verified in this read-only audit.',
  ].join('\n\n')
}

async function runStructuredRole(
  ctx: Context,
  provider: string,
  parent: Agent,
  signal: AbortSignal,
  label: string,
  rolePrompt: string,
  outputSchema: ObjectJsonSchema,
  toolFilter: ToolRestriction | undefined,
  persona: string,
): Promise<{ readonly id: SessionId; readonly result: SubagentResult }> {
  const run = await ctx.subagents.start(provider, {
    label,
    prompt: prompt(rolePrompt),
    parent,
    signal,
    outputSchema,
    ...toolFilter === undefined ? {} : { toolFilter },
    persona,
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed' || result.structured === undefined) {
      throw new Error(`${label} ended with ${result.stopReason} before producing structured output`)
    }
    return { id: run.id, result }
  } finally {
    await run.dispose()
  }
}

type SnapshotChanges = {
  readonly [K in keyof Omit<ComplexGoalSnapshot, 'revision' | 'goalId' | 'objective' | 'maxRounds'>]?:
    ComplexGoalSnapshot[K] | undefined
}

function nextSnapshot(
  snapshot: ComplexGoalSnapshot,
  operation: ComplexGoalOperation,
  changes: SnapshotChanges,
): { readonly change: ComplexGoalChange; readonly snapshot: ComplexGoalSnapshot } {
  const next = Object.fromEntries(Object.entries({
    ...snapshot,
    ...changes,
    revision: snapshot.revision + 1,
  }).filter(([, value]) => value !== undefined)) as unknown as ComplexGoalSnapshot
  return {
    snapshot: next,
    change: {
      kind: 'complex-goal/change',
      version: COMPLEX_GOAL_CHANGE_VERSION,
      operation,
      snapshot: next,
    },
  }
}

async function commit(
  ctx: Context,
  agent: Agent,
  snapshot: ComplexGoalSnapshot,
  operation: ComplexGoalOperation,
  changes: SnapshotChanges,
): Promise<ComplexGoalSnapshot> {
  const next = nextSnapshot(snapshot, operation, changes)
  agent.session.append('complex-goal/change', next.change)
  await ctx.sessions.flush(agent.session)
  return next.snapshot
}

function currentGoal(ctx: Context, agent: Agent, snapshot: ComplexGoalSnapshot): GoalView {
  const goal = ctx.goals.get(agent)
  if (goal === undefined || goal.id !== snapshot.goalId || goal.objective !== snapshot.objective) {
    throw new Error('complex goal no longer owns the current goal state')
  }
  return goal
}

function completeGoal(ctx: Context, agent: Agent, snapshot: ComplexGoalSnapshot): void {
  const goal = currentGoal(ctx, agent, snapshot)
  if (goal.phase !== 'complete') ctx.goals.complete(agent, goalRef(goal))
}

function blockGoal(ctx: Context, agent: Agent, snapshot: ComplexGoalSnapshot, code: string, message: string): void {
  const goal = currentGoal(ctx, agent, snapshot)
  if (goal.phase === 'active') ctx.goals.block(agent, goalRef(goal), { code, message })
}

function boundedText(value: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return { text: value, truncated: false }
  let text = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maxBytes) break
    text += character
    bytes += size
  }
  return { text, truncated: true }
}

function gateResult(
  gate: ComplexGoalVerificationGate,
  result: ShellRunResult,
  outputMaxBytes: number,
): ComplexGoalVerificationGateResult {
  const stdout = boundedText(result.stdout.text, outputMaxBytes)
  const sandbox = result.sandbox?.mode === 'read-only'
    ? {
        mode: 'read-only' as const,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement === undefined ? {} : { enforcement: result.sandbox.enforcement },
        ...result.sandbox.runnerFailed === undefined ? {} : { runnerFailed: result.sandbox.runnerFailed },
      }
    : undefined
  const status = sandbox === undefined || sandbox.runnerFailed === true || result.aborted
    ? 'runner-failed'
    : result.timedOut
      ? 'timed-out'
      : result.exitCode === 0 && result.signal === null && !sandbox.denied
        ? 'passed'
        : 'failed'
  const missingSandbox = 'Verification executor did not report read-only sandbox enforcement.'
  const stderr = boundedText(sandbox === undefined
    ? `${missingSandbox}${result.stderr.text.length === 0 ? '' : `\n${result.stderr.text}`}`
    : result.stderr.text, outputMaxBytes)
  return {
    id: gate.id,
    command: gate.command,
    status,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: result.stdout.truncated || stdout.truncated,
    stderrTruncated: result.stderr.truncated || stderr.truncated,
    ...sandbox === undefined ? {} : { sandbox },
  }
}

function failedGateResult(
  gate: ComplexGoalVerificationGate,
  error: unknown,
  outputMaxBytes: number,
): ComplexGoalVerificationGateResult {
  const stderr = boundedText(error instanceof Error ? error.message : String(error), outputMaxBytes)
  return {
    id: gate.id,
    command: gate.command,
    status: 'runner-failed',
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: stderr.text,
    stdoutTruncated: false,
    stderrTruncated: stderr.truncated,
  }
}

async function runVerificationGate(
  ctx: Context,
  parent: Agent,
  gate: ComplexGoalVerificationGate,
  outputMaxBytes: number,
  signal: AbortSignal,
): Promise<ComplexGoalVerificationGateResult> {
  if (ctx.shell.sandboxMode === undefined) {
    return failedGateResult(
      gate,
      new Error('Verification requires a shell executor that supports read-only sandbox enforcement.'),
      outputMaxBytes,
    )
  }
  try {
    const result = await ctx.shell.run(ctx.shell.resolve({
      command: gate.command,
      ...parent.session.header.cwd === undefined ? {} : { workdir: parent.session.header.cwd },
      timeoutMs: gate.timeoutMs,
      stdoutMaxBytes: outputMaxBytes,
      signal,
      sandboxPolicy: ctx.sandboxPolicy.resolve({ session: parent.session, mode: 'read-only' }),
    }))
    if (signal.aborted) signal.throwIfAborted()
    return gateResult(gate, result, outputMaxBytes)
  } catch (error: unknown) {
    if (signal.aborted) signal.throwIfAborted()
    return failedGateResult(gate, error, outputMaxBytes)
  }
}

async function verifyRound(
  ctx: Context,
  parent: Agent,
  snapshot: ComplexGoalSnapshot,
  signal: AbortSignal,
): Promise<ComplexGoalSnapshot> {
  if (snapshot.verificationGates.length === 0 || snapshot.latestVerification?.round === snapshot.round) {
    return snapshot
  }
  const gates: ComplexGoalVerificationGateResult[] = []
  for (const gate of snapshot.verificationGates) {
    gates.push(await runVerificationGate(ctx, parent, gate, snapshot.verificationOutputMaxBytes, signal))
  }
  const verification: ComplexGoalVerification = {
    round: snapshot.round,
    status: gates.every(gate => gate.status === 'passed') ? 'passed' : 'failed',
    gates,
  }
  return commit(ctx, parent, snapshot, 'verify', {
    phase: 'auditing',
    latestVerification: verification,
    resumeAt: undefined,
    blocker: undefined,
  })
}

function verificationPassed(snapshot: ComplexGoalSnapshot): boolean {
  return snapshot.verificationGates.length === 0 || snapshot.latestVerification?.status === 'passed'
}

function render(snapshot: ComplexGoalSnapshot): string {
  const lines = [
    `Complex task goal: ${snapshot.phase}`,
    `Objective: ${snapshot.objective}`,
    `Rounds: ${snapshot.round}/${snapshot.maxRounds}`,
    `Deadline: ${new Date(snapshot.deadlineAtMs).toISOString()}`,
  ]
  if (snapshot.verificationGates.length > 0) {
    lines.push(`Verification: ${snapshot.latestVerification?.status ?? 'pending'}`)
    if (snapshot.latestVerification !== undefined) {
      lines.push(`Gates: ${snapshot.latestVerification.gates.map(gate => `${gate.id}=${gate.status}`).join('; ')}`)
    }
  }
  if (snapshot.latestAudit !== undefined) {
    lines.push(`Audit: ${snapshot.latestAudit.status} / ${snapshot.latestAudit.integrity} / ${snapshot.latestAudit.alignment}`)
    lines.push(`Evidence: ${snapshot.latestAudit.evidence.join('; ') || '(none)'}`)
    if (snapshot.latestAudit.missing.length > 0) lines.push(`Missing: ${snapshot.latestAudit.missing.join('; ')}`)
  }
  if (snapshot.blocker !== undefined) lines.push(`Blocker: ${snapshot.blocker}`)
  lines.push('', snapshot.phase === 'paused' || snapshot.phase === 'blocked'
    ? 'Command: /goal-complex resume'
    : USAGE)
  return lines.join('\n')
}

async function runLoop(
  ctx: Context,
  parent: Agent,
  initial: ComplexGoalSnapshot,
  signal: AbortSignal,
): Promise<ComplexGoalSnapshot> {
  let snapshot = initial
  if (snapshot.phase === 'complete') {
    completeGoal(ctx, parent, snapshot)
    return snapshot
  }
  if (snapshot.phase === 'blocked') {
    const goal = currentGoal(ctx, parent, snapshot)
    const resumed = ctx.goals.resume(parent, goalRef(goal))
    ctx.goals.disarm(parent)
    void resumed
    snapshot = await commit(ctx, parent, snapshot, 'resume', {
      phase: snapshot.resumeAt ?? 'planning',
      blocker: undefined,
      resumeAt: undefined,
    })
  } else if (snapshot.phase === 'paused') {
    const goal = currentGoal(ctx, parent, snapshot)
    if (goal.phase !== 'active') ctx.goals.resume(parent, goalRef(goal))
    ctx.goals.disarm(parent)
    snapshot = await commit(ctx, parent, snapshot, 'resume', {
      phase: snapshot.resumeAt ?? 'planning',
      blocker: undefined,
      resumeAt: undefined,
    })
  }

  try {
    while (!signal.aborted) {
      if (snapshot.phase === 'executing' || snapshot.phase === 'auditing') {
        snapshot = await verifyRound(ctx, parent, snapshot, signal)
        const audited = await runStructuredRole(
          ctx,
          AUDITOR_PROVIDER,
          parent,
          signal,
          `Complex goal Auditor ${snapshot.round}`,
          auditorPrompt(snapshot),
          AUDITOR_SCHEMA,
          auditorToolFilter(ctx, parent),
          'Independently verify the task from authoritative environment evidence. Remain read-only and fail closed.',
        )
        const audit = decodeAudit(audited.result.structured, audited.id)
        const verifiedComplete = audit.status === 'complete'
          && audit.integrity === 'clean'
          && audit.alignment === 'aligned'
          && verificationPassed(snapshot)
        if (verifiedComplete) {
          snapshot = await commit(ctx, parent, snapshot, 'audit', {
            phase: 'complete',
            trustedState: audit.verifiedState,
            latestAudit: audit,
            resumeAt: undefined,
            blocker: undefined,
          })
          completeGoal(ctx, parent, snapshot)
          await ctx.sessions.flush(parent.session)
          return snapshot
        }
        if (audit.status === 'blocked' || audit.integrity === 'violation') {
          const blocker = audit.blocker || `Auditor reported integrity ${audit.integrity}.`
          snapshot = await commit(ctx, parent, snapshot, 'audit', {
            phase: 'blocked',
            trustedState: audit.verifiedState,
            latestAudit: audit,
            resumeAt: 'planning',
            blocker,
          })
          blockGoal(ctx, parent, snapshot, audit.integrity === 'violation' ? 'audit-integrity' : 'audit-blocked', blocker)
          await ctx.sessions.flush(parent.session)
          return snapshot
        }
        snapshot = await commit(ctx, parent, snapshot, 'audit', {
          phase: 'planning',
          trustedState: audit.status === 'complete' && !verificationPassed(snapshot)
            ? snapshot.trustedState
            : audit.verifiedState,
          latestAudit: audit,
          resumeAt: undefined,
          blocker: undefined,
        })
        if (snapshot.round >= snapshot.maxRounds) {
          const blocker = `Complex goal reached its configured limit of ${snapshot.maxRounds} rounds.`
          snapshot = await commit(ctx, parent, snapshot, 'block', {
            phase: 'blocked', resumeAt: 'planning', blocker,
          })
          blockGoal(ctx, parent, snapshot, 'round-limit', blocker)
          await ctx.sessions.flush(parent.session)
          return snapshot
        }
        continue
      }

      if (snapshot.phase !== 'planning') return snapshot
      const nextRound = snapshot.round + 1
      const managed = await runStructuredRole(
        ctx,
        'spawn',
        parent,
        signal,
        `Complex goal Manager ${nextRound}`,
        managerPrompt(snapshot, nextRound),
        MANAGER_SCHEMA,
        { allow: [] },
        'Manage one verified complex goal. Never inspect the environment or claim completion.',
      )
      const decision = decodeManager(managed.result.structured)
      if (decision.route === 'blocked') {
        snapshot = await commit(ctx, parent, snapshot, 'block', {
          phase: 'blocked', round: nextRound, resumeAt: 'planning', blocker: decision.blocker,
        })
        blockGoal(ctx, parent, snapshot, 'manager-blocked', decision.blocker)
        await ctx.sessions.flush(parent.session)
        return snapshot
      }
      const contract = decision.contract
      if (contract === undefined) throw new Error('complex goal Manager omitted its contract')
      snapshot = await commit(ctx, parent, snapshot, 'manage', {
        phase: decision.route === 'audit' ? 'auditing' : 'executing',
        round: nextRound,
        contract,
        latestExecution: undefined,
        latestVerification: undefined,
        resumeAt: undefined,
        blocker: undefined,
      })
      if (decision.route === 'audit') continue

      const executed = await runStructuredRole(
        ctx,
        'spawn',
        parent,
        signal,
        `Complex goal Executor ${snapshot.round}`,
        executorPrompt(snapshot),
        EXECUTOR_SCHEMA,
        executorToolFilter(ctx, parent),
        'Execute exactly one bounded task, preserve unrelated work, and report concrete evidence without claiming certification.',
      )
      const execution: ComplexGoalExecution = decodeExecution(executed.result.structured, executed.id)
      snapshot = await commit(ctx, parent, snapshot, 'execute', {
        phase: 'auditing', latestExecution: execution, resumeAt: undefined, blocker: undefined,
      })
    }
    throw signal.reason instanceof Error ? signal.reason : new Error('complex goal aborted')
  } catch (error: unknown) {
    if (timeoutOf(signal, TIME_LIMIT_CODE) !== undefined
      && snapshot.phase !== 'complete' && snapshot.phase !== 'blocked') {
      const blocker = `Complex goal exceeded its wall-clock limit at ${new Date(snapshot.deadlineAtMs).toISOString()}.`
      snapshot = await commit(ctx, parent, snapshot, 'block', {
        phase: 'blocked', resumeAt: 'planning', blocker,
      })
      blockGoal(ctx, parent, snapshot, 'time-limit', blocker)
      await ctx.sessions.flush(parent.session)
      return snapshot
    }
    if (snapshot.phase !== 'complete' && snapshot.phase !== 'blocked') {
      const resumeAt = snapshot.phase === 'executing' || snapshot.phase === 'auditing' ? 'auditing' : 'planning'
      try {
        snapshot = await commit(ctx, parent, snapshot, 'interrupt', {
          phase: 'paused', resumeAt, blocker: undefined,
        })
      } catch (checkpointError: unknown) {
        ctx.logger.warn(`complex-goal: could not persist interruption: ${String(checkpointError)}`)
      }
    }
    throw error
  }
}

async function startGoal(
  ctx: Context,
  agent: Agent,
  objective: string,
  config: ResolvedConfig,
): Promise<ComplexGoalSnapshot> {
  const current = foldComplexGoal(agent.session.events)
  if (current !== undefined && current.phase !== 'complete') {
    throw new Error('A non-complete complex task goal already exists. Resume or finish it before starting another.')
  }
  const existingGoal = ctx.goals.get(agent)
  if (existingGoal !== undefined && existingGoal.phase !== 'complete') {
    throw new Error('The session already has a non-complete ordinary goal. Pause, complete, or clear it before starting a complex task goal.')
  }
  const goal = ctx.goals.create(agent, { objective })
  ctx.goals.disarm(agent)
  const startedAtMs = Date.now()
  const snapshot: ComplexGoalSnapshot = {
    revision: 1,
    goalId: goal.id,
    objective: goal.objective,
    startedAtMs,
    deadlineAtMs: startedAtMs + config.maxDurationMs,
    phase: 'planning',
    round: 0,
    maxRounds: goal.maxGoalRounds,
    verificationGates: config.verificationGates,
    verificationOutputMaxBytes: config.verificationOutputMaxBytes,
    trustedState: emptyVerifiedState(),
  }
  agent.session.append('complex-goal/change', {
    kind: 'complex-goal/change',
    version: COMPLEX_GOAL_CHANGE_VERSION,
    operation: 'start',
    snapshot,
  })
  await ctx.sessions.flush(agent.session)
  return snapshot
}

async function runWithinBudget(
  ctx: Context,
  agent: Agent,
  initial: ComplexGoalSnapshot,
  signal: AbortSignal,
): Promise<ComplexGoalSnapshot> {
  if (initial.phase === 'complete' || initial.phase === 'blocked' && Date.now() >= initial.deadlineAtMs) {
    return initial
  }
  const remaining = initial.deadlineAtMs - Date.now()
  if (remaining <= 0) {
    const blocker = `Complex goal exceeded its wall-clock limit at ${new Date(initial.deadlineAtMs).toISOString()}.`
    const snapshot = await commit(ctx, agent, initial, 'block', {
      phase: 'blocked', resumeAt: 'planning', blocker,
    })
    blockGoal(ctx, agent, snapshot, 'time-limit', blocker)
    await ctx.sessions.flush(agent.session)
    return snapshot
  }
  const runDeadline = deadline(signal, remaining, TIME_LIMIT_CODE)
  try {
    return await runLoop(ctx, agent, initial, runDeadline.signal)
  } finally {
    runDeadline[Symbol.dispose]()
  }
}

async function trackedRun(
  active: Map<Agent, ActiveRun>,
  agent: Agent,
  signal: AbortSignal,
  runner: (signal: AbortSignal) => Promise<ComplexGoalSnapshot>,
): Promise<ComplexGoalSnapshot> {
  if (active.has(agent)) throw new Error('A complex task goal is already running for this session.')
  const controller = new AbortController()
  const done = runner(AbortSignal.any([signal, controller.signal]))
  const tracked: ActiveRun = { controller, done }
  active.set(agent, tracked)
  try {
    return await done
  } finally {
    if (active.get(agent) === tracked) active.delete(agent)
  }
}

interface ComplexGoalToolValue {
  readonly phase: ComplexGoalSnapshot['phase']
  readonly round: number
  readonly maxRounds: number
  readonly verification: 'not-configured' | 'pending' | 'passed' | 'failed'
  readonly summary: string
}

function toolValue(snapshot: ComplexGoalSnapshot): ComplexGoalToolValue {
  return {
    phase: snapshot.phase,
    round: snapshot.round,
    maxRounds: snapshot.maxRounds,
    verification: snapshot.verificationGates.length === 0
      ? 'not-configured'
      : snapshot.latestVerification?.status ?? 'pending',
    summary: render(snapshot),
  }
}

function presentComplexGoal(args: { objective: string }): GenericCallView {
  return { card: 'generic', title: 'Run independently verified complex task', kind: 'other', rawInput: args.objective }
}

/** Register model and command entry points plus the private read-only Auditor provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const active = new Map<Agent, ActiveRun>()
  ctx.subagents.registerProvider(new ReadOnlyAuditorProvider())

  ctx.systemPrompt.section({
    name: 'tool:complex-goal',
    order: 115,
    text: 'Use complex_goal when a direct human request in any language is genuinely complex, has multiple dependent stages, and benefits from fresh execution plus independent evidence-based completion checks. Infer this from task semantics; no keyword, slash command, or manual mode switch is required. Do not use it for routine single-turn work.',
  })

  ctx.tools.register(defineTool({
    name: 'complex_goal',
    description: 'Run one genuinely complex direct-human objective as a durable Manager–Executor–Auditor task. Select this from semantic intent in any language when staged fresh execution and independently checked completion materially improve reliability. Do not use for routine single-turn work. Deployment-owned deterministic commands, when configured, run under filesystem read-only sandboxing and must all pass before completion.',
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The immutable complex completion objective inferred from the current direct human request.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string', required: true, enum: ['planning', 'executing', 'auditing', 'paused', 'blocked', 'complete'] },
          round: { type: 'integer', required: true },
          maxRounds: { type: 'integer', required: true },
          verification: { type: 'string', required: true, enum: ['not-configured', 'pending', 'passed', 'failed'] },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute(args, exec) {
      const execution = goalToolExecution(ctx, exec)
      requireDirectHuman(ctx, execution)
      const objective = normalizedText(args.objective.trim(), 'complex goal objective')
      const initial = await startGoal(ctx, execution.agent, objective, resolved)
      return toolValue(await trackedRun(active, execution.agent, exec.signal,
        signal => runWithinBudget(ctx, execution.agent, initial, signal)))
    },
    presentCall: presentComplexGoal,
  }))

  ctx.effect(() => async () => {
    const runs = [...active.values()]
    for (const run of runs) run.controller.abort(new Error('complex-goal plugin disposed'))
    await Promise.allSettled(runs.map(run => run.done))
  }, 'complex-goal: active runs')

  ctx.commands.register({
    name: COMMAND_NAME,
    description: 'execute a complex objective in stages with independent verification',
    input: { hint: '<objective>' },
    recordInput: false,
    async handler(invocation: CommandInvocation): Promise<CommandResult> {
      const input = invocation.rawInput.trim()
      const current = foldComplexGoal(invocation.agent.session.events)
      if (input.length === 0) {
        return current === undefined
          ? { kind: 'success', text: `No complex task goal is currently recorded.\n${USAGE}` }
          : { kind: 'success', text: render(current) }
      }
      try {
        const initial = input.toLowerCase() === 'resume'
          ? current
          : await startGoal(ctx, invocation.agent, input, resolved)
        if (initial === undefined) {
          return { kind: 'error', text: `No resumable complex task goal is recorded.\n${USAGE}` }
        }
        const result = await trackedRun(active, invocation.agent, invocation.signal, signal =>
          invocation.agent.runMaintenance(maintenanceSignal =>
            runWithinBudget(ctx, invocation.agent, initial, AbortSignal.any([signal, maintenanceSignal]))))
        return { kind: 'success', text: render(result) }
      } catch (error: unknown) {
        const failed = foldComplexGoal(invocation.agent.session.events)
        const resume = failed?.phase === 'paused' || failed?.phase === 'blocked'
          ? '\nCommand: /goal-complex resume'
          : ''
        return {
          kind: 'error',
          text: `Complex task goal did not run: ${error instanceof Error ? error.message : String(error)}${resume}`,
        }
      }
    },
  })
}
