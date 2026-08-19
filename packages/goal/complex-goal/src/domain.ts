/** Durable decoding and replay for independently verified complex goals. */

import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import type {
  ComplexGoalAudit,
  ComplexGoalChange,
  ComplexGoalContract,
  ComplexGoalExecution,
  ComplexGoalOperation,
  ComplexGoalPhase,
  ComplexGoalSnapshot,
  ComplexGoalVerification,
  ComplexGoalVerificationGate,
  ComplexGoalVerificationGateResult,
  ComplexGoalVerificationSandbox,
  VerifiedArtifact,
  VerifiedComplexGoalState,
  VerifiedRequirement,
} from './types.ts'

export const COMPLEX_GOAL_CHANGE_VERSION = 2

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete state after one independently verified complex-goal transition.
     * @mode emit
     * @param payload - versioned operation and complete post-transition snapshot.
     */
    'complex-goal/change': ComplexGoalChange
  }
}

/** Empty trusted state before the first Auditor report. */
export function emptyVerifiedState(): VerifiedComplexGoalState {
  return { requirements: [], artifacts: [], facts: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional])
  const actual = Object.keys(value)
  if (required.some(key => !Object.hasOwn(value, key)) || actual.some(key => !allowed.has(key))) {
    throw new Error(`complex goal value must contain required fields ${required.join(', ')} and only optional fields ${optional.join(', ') || '(none)'}`)
  }
}

function normalizedText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value !== value.trim() || (!allowEmpty && value.length === 0)) {
    throw new Error(`complex goal ${field} must be ${allowEmpty ? 'normalized' : 'non-empty and normalized'}`)
  }
  return value
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`complex goal ${field} must be a string`)
  return value
}

function textList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`complex goal ${field} must be an array`)
  return value.map((entry, index) => normalizedText(entry, `${field}[${index}]`))
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`complex goal ${field} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`complex goal ${field} must be a non-negative safe integer`)
  }
  return value
}

function nullableNonNegativeInteger(value: unknown, field: string): number | null {
  return value === null ? null : nonNegativeInteger(value, field)
}

function nullableText(value: unknown, field: string): string | null {
  return value === null ? null : normalizedText(value, field)
}

function oneOf<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new Error(`complex goal ${field} must be one of ${choices.join(', ')}`)
  }
  return value as T
}

function decodeRequirement(value: unknown, index: number): VerifiedRequirement {
  if (!isRecord(value)) throw new Error(`complex goal trustedState.requirements[${index}] must be a record`)
  exactKeys(value, ['requirement', 'status', 'evidence'])
  return {
    requirement: normalizedText(value['requirement'], `trustedState.requirements[${index}].requirement`),
    status: oneOf(value['status'], `trustedState.requirements[${index}].status`, ['satisfied', 'pending', 'blocked']),
    evidence: textList(value['evidence'], `trustedState.requirements[${index}].evidence`),
  }
}

function decodeArtifact(value: unknown, index: number): VerifiedArtifact {
  if (!isRecord(value)) throw new Error(`complex goal trustedState.artifacts[${index}] must be a record`)
  exactKeys(value, ['artifact', 'status', 'evidence'])
  return {
    artifact: normalizedText(value['artifact'], `trustedState.artifacts[${index}].artifact`),
    status: oneOf(value['status'], `trustedState.artifacts[${index}].status`, ['verified', 'missing', 'suspect']),
    evidence: textList(value['evidence'], `trustedState.artifacts[${index}].evidence`),
  }
}

/** Decode one Auditor-owned state snapshot at a model or durable boundary. */
export function decodeVerifiedState(value: unknown): VerifiedComplexGoalState {
  if (!isRecord(value)) throw new Error('complex goal trustedState must be a record')
  exactKeys(value, ['requirements', 'artifacts', 'facts'])
  if (!Array.isArray(value['requirements']) || !Array.isArray(value['artifacts'])) {
    throw new Error('complex goal trustedState requirements and artifacts must be arrays')
  }
  return {
    requirements: value['requirements'].map(decodeRequirement),
    artifacts: value['artifacts'].map(decodeArtifact),
    facts: textList(value['facts'], 'trustedState.facts'),
  }
}

function decodeContract(value: unknown): ComplexGoalContract {
  if (!isRecord(value)) throw new Error('complex goal contract must be a record')
  exactKeys(value, ['task', 'acceptance'])
  const acceptance = textList(value['acceptance'], 'contract.acceptance')
  if (acceptance.length === 0) throw new Error('complex goal contract.acceptance must not be empty')
  return { task: normalizedText(value['task'], 'contract.task'), acceptance }
}

function decodeVerificationGate(value: unknown, index: number): ComplexGoalVerificationGate {
  if (!isRecord(value)) throw new Error(`complex goal verificationGates[${index}] must be a record`)
  exactKeys(value, ['id', 'command', 'timeoutMs'])
  return {
    id: normalizedText(value['id'], `verificationGates[${index}].id`),
    command: normalizedText(value['command'], `verificationGates[${index}].command`),
    timeoutMs: positiveInteger(value['timeoutMs'], `verificationGates[${index}].timeoutMs`),
  }
}

function decodeVerificationSandbox(value: unknown, index: number): ComplexGoalVerificationSandbox {
  if (!isRecord(value)) throw new Error(`complex goal verification.gates[${index}].sandbox must be a record`)
  exactKeys(value, ['mode', 'denied'], ['enforcement', 'runnerFailed'])
  if (value['mode'] !== 'read-only' || typeof value['denied'] !== 'boolean') {
    throw new Error(`complex goal verification.gates[${index}].sandbox must report read-only mode and denied`)
  }
  return {
    mode: 'read-only',
    denied: value['denied'],
    ...value['enforcement'] === undefined ? {} : {
      enforcement: oneOf(value['enforcement'], `verification.gates[${index}].sandbox.enforcement`, ['full', 'partial']),
    },
    ...value['runnerFailed'] === undefined ? {} : (() => {
      if (typeof value['runnerFailed'] !== 'boolean') {
        throw new Error(`complex goal verification.gates[${index}].sandbox.runnerFailed must be a boolean`)
      }
      return { runnerFailed: value['runnerFailed'] }
    })(),
  }
}

function decodeVerificationGateResult(value: unknown, index: number): ComplexGoalVerificationGateResult {
  if (!isRecord(value)) throw new Error(`complex goal verification.gates[${index}] must be a record`)
  exactKeys(value, [
    'id', 'command', 'status', 'exitCode', 'signal', 'stdout', 'stderr',
    'stdoutTruncated', 'stderrTruncated',
  ], ['sandbox'])
  if (typeof value['stdoutTruncated'] !== 'boolean' || typeof value['stderrTruncated'] !== 'boolean') {
    throw new Error(`complex goal verification.gates[${index}] truncation flags must be booleans`)
  }
  return {
    id: normalizedText(value['id'], `verification.gates[${index}].id`),
    command: normalizedText(value['command'], `verification.gates[${index}].command`),
    status: oneOf(value['status'], `verification.gates[${index}].status`,
      ['passed', 'failed', 'timed-out', 'runner-failed']),
    exitCode: nullableNonNegativeInteger(value['exitCode'], `verification.gates[${index}].exitCode`),
    signal: nullableText(value['signal'], `verification.gates[${index}].signal`),
    stdout: text(value['stdout'], `verification.gates[${index}].stdout`),
    stderr: text(value['stderr'], `verification.gates[${index}].stderr`),
    stdoutTruncated: value['stdoutTruncated'],
    stderrTruncated: value['stderrTruncated'],
    ...value['sandbox'] === undefined ? {} : { sandbox: decodeVerificationSandbox(value['sandbox'], index) },
  }
}

function decodeVerification(value: unknown): ComplexGoalVerification {
  if (!isRecord(value)) throw new Error('complex goal latestVerification must be a record')
  exactKeys(value, ['round', 'status', 'gates'])
  if (!Array.isArray(value['gates']) || value['gates'].length === 0) {
    throw new Error('complex goal latestVerification.gates must be a non-empty array')
  }
  const verification: ComplexGoalVerification = {
    round: positiveInteger(value['round'], 'latestVerification.round'),
    status: oneOf(value['status'], 'latestVerification.status', ['passed', 'failed']),
    gates: value['gates'].map(decodeVerificationGateResult),
  }
  const allPassed = verification.gates.every(gate => gate.status === 'passed')
  if ((verification.status === 'passed') !== allPassed) {
    throw new Error('complex goal latestVerification status must match its gate results')
  }
  return verification
}

/** Decode one untrusted Executor report at a model or durable boundary. */
export function decodeExecution(value: unknown, childId?: ComplexGoalExecution['childId']): ComplexGoalExecution {
  if (!isRecord(value)) throw new Error('complex goal latestExecution must be a record')
  exactKeys(value, childId === undefined
    ? ['childId', 'status', 'summary', 'evidence', 'blocker']
    : ['status', 'summary', 'evidence', 'blocker'])
  const result: ComplexGoalExecution = {
    childId: childId ?? (normalizedText(value['childId'], 'latestExecution.childId') as ComplexGoalExecution['childId']),
    status: oneOf(value['status'], 'latestExecution.status', ['complete', 'continue', 'blocked']),
    summary: normalizedText(value['summary'], 'latestExecution.summary'),
    evidence: textList(value['evidence'], 'latestExecution.evidence'),
    blocker: normalizedText(value['blocker'], 'latestExecution.blocker', true),
  }
  if (result.status === 'blocked' && result.blocker.length === 0) {
    throw new Error('complex goal blocked Executor report requires blocker')
  }
  if (result.status !== 'blocked' && result.blocker.length !== 0) {
    throw new Error('complex goal non-blocked Executor report requires an empty blocker')
  }
  return result
}

/** Decode one strict Auditor result at a model or durable boundary. */
export function decodeAudit(value: unknown, childId?: ComplexGoalAudit['childId']): ComplexGoalAudit {
  if (!isRecord(value)) throw new Error('complex goal audit must be a record')
  exactKeys(value, childId === undefined
    ? ['childId', 'status', 'integrity', 'alignment', 'summary', 'evidence', 'missing', 'nextTask', 'blocker', 'verifiedState']
    : ['status', 'integrity', 'alignment', 'summary', 'evidence', 'missing', 'nextTask', 'blocker', 'verifiedState'])
  const result: ComplexGoalAudit = {
    childId: childId ?? (normalizedText(value['childId'], 'audit.childId') as ComplexGoalAudit['childId']),
    status: oneOf(value['status'], 'audit.status', ['complete', 'continue', 'blocked']),
    integrity: oneOf(value['integrity'], 'audit.integrity', ['clean', 'suspect', 'violation']),
    alignment: oneOf(value['alignment'], 'audit.alignment', ['aligned', 'partial', 'misaligned']),
    summary: normalizedText(value['summary'], 'audit.summary'),
    evidence: textList(value['evidence'], 'audit.evidence'),
    missing: textList(value['missing'], 'audit.missing'),
    nextTask: normalizedText(value['nextTask'], 'audit.nextTask', true),
    blocker: normalizedText(value['blocker'], 'audit.blocker', true),
    verifiedState: decodeVerifiedState(value['verifiedState']),
  }
  if (result.status === 'complete'
    && (result.evidence.length === 0 || result.missing.length !== 0 || result.nextTask.length !== 0
      || result.blocker.length !== 0)) {
    throw new Error('complex goal complete audit requires evidence and no missing, nextTask, or blocker')
  }
  if (result.status === 'continue' && (result.nextTask.length === 0 || result.blocker.length !== 0)) {
    throw new Error('complex goal continuing audit requires nextTask and an empty blocker')
  }
  if (result.status === 'blocked' && result.blocker.length === 0) {
    throw new Error('complex goal blocked audit requires blocker')
  }
  return result
}

function decodeSnapshot(value: unknown): ComplexGoalSnapshot {
  if (!isRecord(value)) throw new Error('complex goal snapshot must be a record')
  exactKeys(value, [
    'revision', 'goalId', 'objective', 'startedAtMs', 'deadlineAtMs', 'phase', 'round', 'maxRounds',
    'verificationGates', 'verificationOutputMaxBytes', 'trustedState',
  ], ['contract', 'latestExecution', 'latestVerification', 'latestAudit', 'resumeAt', 'blocker'])
  const phase = oneOf<ComplexGoalPhase>(value['phase'], 'snapshot.phase',
    ['planning', 'executing', 'auditing', 'paused', 'blocked', 'complete'])
  if (!Array.isArray(value['verificationGates'])) {
    throw new Error('complex goal snapshot.verificationGates must be an array')
  }
  const verificationGates = value['verificationGates'].map(decodeVerificationGate)
  if (new Set(verificationGates.map(gate => gate.id)).size !== verificationGates.length) {
    throw new Error('complex goal snapshot.verificationGates ids must be unique')
  }
  const snapshot: ComplexGoalSnapshot = {
    revision: positiveInteger(value['revision'], 'snapshot.revision'),
    goalId: normalizedText(value['goalId'], 'snapshot.goalId') as ComplexGoalSnapshot['goalId'],
    objective: normalizedText(value['objective'], 'snapshot.objective'),
    startedAtMs: positiveInteger(value['startedAtMs'], 'snapshot.startedAtMs'),
    deadlineAtMs: positiveInteger(value['deadlineAtMs'], 'snapshot.deadlineAtMs'),
    phase,
    round: nonNegativeInteger(value['round'], 'snapshot.round'),
    maxRounds: positiveInteger(value['maxRounds'], 'snapshot.maxRounds'),
    verificationGates,
    verificationOutputMaxBytes: positiveInteger(value['verificationOutputMaxBytes'], 'snapshot.verificationOutputMaxBytes'),
    trustedState: decodeVerifiedState(value['trustedState']),
    ...value['contract'] === undefined ? {} : { contract: decodeContract(value['contract']) },
    ...value['latestExecution'] === undefined ? {} : { latestExecution: decodeExecution(value['latestExecution']) },
    ...value['latestVerification'] === undefined ? {} : { latestVerification: decodeVerification(value['latestVerification']) },
    ...value['latestAudit'] === undefined ? {} : { latestAudit: decodeAudit(value['latestAudit']) },
    ...value['resumeAt'] === undefined ? {} : {
      resumeAt: oneOf(value['resumeAt'], 'snapshot.resumeAt', ['planning', 'auditing']),
    },
    ...value['blocker'] === undefined ? {} : { blocker: normalizedText(value['blocker'], 'snapshot.blocker') },
  }
  if (snapshot.deadlineAtMs <= snapshot.startedAtMs) {
    throw new Error('complex goal deadlineAtMs must be later than startedAtMs')
  }
  if (snapshot.round > snapshot.maxRounds) throw new Error('complex goal round cannot exceed maxRounds')
  if ((phase === 'executing' || phase === 'auditing') && snapshot.contract === undefined) {
    throw new Error(`complex goal ${phase} snapshot requires a contract`)
  }
  if (phase === 'paused' && snapshot.resumeAt === undefined) {
    throw new Error('complex goal paused snapshot requires resumeAt')
  }
  if (phase === 'blocked' && snapshot.blocker === undefined) {
    throw new Error('complex goal blocked snapshot requires blocker')
  }
  if (phase === 'complete') {
    const audit = snapshot.latestAudit
    if (audit?.status !== 'complete' || audit.integrity !== 'clean' || audit.alignment !== 'aligned') {
      throw new Error('complex goal complete snapshot requires a complete, clean, aligned audit')
    }
  }
  if (snapshot.latestVerification !== undefined) {
    if (snapshot.latestVerification.round !== snapshot.round
      || snapshot.latestVerification.gates.length !== snapshot.verificationGates.length
      || snapshot.latestVerification.gates.some((result, index) => {
        const gate = snapshot.verificationGates[index]
        return gate === undefined || result.id !== gate.id || result.command !== gate.command
      })) {
      throw new Error('complex goal latestVerification must match the current round and configured gates')
    }
  }
  if (phase === 'complete' && snapshot.verificationGates.length > 0
    && snapshot.latestVerification?.status !== 'passed') {
    throw new Error('complex goal complete snapshot requires all configured verification gates to pass')
  }
  return snapshot
}

/** Strictly decode a change that declares this package's event kind. */
export function decodeComplexGoalChange(value: unknown): ComplexGoalChange | undefined {
  if (!isRecord(value) || value['kind'] !== 'complex-goal/change') return undefined
  exactKeys(value, ['kind', 'version', 'operation', 'snapshot'])
  if (value['version'] !== COMPLEX_GOAL_CHANGE_VERSION) {
    throw new Error(`unsupported complex goal change version ${String(value['version'])}`)
  }
  const operation = oneOf<ComplexGoalOperation>(value['operation'], 'operation',
    ['start', 'manage', 'execute', 'verify', 'audit', 'interrupt', 'resume', 'block'])
  return { kind: 'complex-goal/change', version: COMPLEX_GOAL_CHANGE_VERSION, operation, snapshot: decodeSnapshot(value['snapshot']) }
}

/** Mutable replay accumulator. */
export interface ComplexGoalFoldState {
  snapshot: ComplexGoalSnapshot | undefined
}

export function emptyComplexGoalFoldState(): ComplexGoalFoldState {
  return { snapshot: undefined }
}

function assertTransition(previous: ComplexGoalSnapshot | undefined, change: ComplexGoalChange): void {
  const next = change.snapshot
  if (change.operation === 'start') {
    if (previous !== undefined && previous.phase !== 'complete') {
      throw new Error('a complex goal can start only without a current run or after completion')
    }
    if (next.revision !== 1 || next.phase !== 'planning' || next.round !== 0) {
      throw new Error('complex goal start must create revision 1 in planning round 0')
    }
    return
  }
  if (previous === undefined) throw new Error(`complex goal ${change.operation} requires an existing run`)
  if (next.goalId !== previous.goalId || next.objective !== previous.objective
    || next.maxRounds !== previous.maxRounds || next.startedAtMs !== previous.startedAtMs
    || next.deadlineAtMs !== previous.deadlineAtMs
    || next.verificationOutputMaxBytes !== previous.verificationOutputMaxBytes
    || JSON.stringify(next.verificationGates) !== JSON.stringify(previous.verificationGates)
    || next.revision !== previous.revision + 1) {
    throw new Error('complex goal transition must retain identity/objective/budget and increment revision once')
  }
  if (next.round < previous.round || next.round > previous.round + 1) {
    throw new Error('complex goal round must stay constant or advance by one')
  }
  const valid = (() => {
    switch (change.operation) {
      case 'manage': return previous.phase === 'planning' && next.round === previous.round + 1
        && ['executing', 'auditing'].includes(next.phase)
      case 'execute': return previous.phase === 'executing' && next.phase === 'auditing' && next.round === previous.round
      case 'verify': return ['executing', 'auditing'].includes(previous.phase)
        && next.phase === 'auditing' && next.round === previous.round
      case 'audit': return ['executing', 'auditing'].includes(previous.phase)
        && ['planning', 'blocked', 'complete'].includes(next.phase)
        && next.round === previous.round
      case 'interrupt': return !['complete', 'blocked'].includes(previous.phase) && next.phase === 'paused'
        && next.round === previous.round
      case 'resume': return ['paused', 'blocked'].includes(previous.phase)
        && ['planning', 'auditing'].includes(next.phase) && next.round === previous.round
      case 'block': return !['complete', 'blocked'].includes(previous.phase) && next.phase === 'blocked'
        && (next.round === previous.round
          || previous.phase === 'planning' && next.round === previous.round + 1)
    }
  })()
  if (!valid) throw new Error(`invalid complex goal ${change.operation} transition ${previous.phase} -> ${next.phase}`)
}

/** Apply one session event to the strict fold. */
export function applyComplexGoalEvent(state: ComplexGoalFoldState, event: SessionEvent): void {
  if (event.type !== 'complex-goal/change') return
  const change = decodeComplexGoalChange(event.data)
  if (change === undefined) throw new Error('complex-goal/change event has the wrong kind')
  assertTransition(state.snapshot, change)
  state.snapshot = change.snapshot
}

/** Replay the current complex-goal state from a session log. */
export function foldComplexGoal(events: readonly SessionEvent[]): ComplexGoalSnapshot | undefined {
  const state = emptyComplexGoalFoldState()
  for (const event of events) applyComplexGoalEvent(state, event)
  return state.snapshot
}
