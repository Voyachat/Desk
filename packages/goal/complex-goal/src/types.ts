/** Pure durable and structured-output types for independently verified complex goals. */

import type { GoalId } from '@voyaseek-ai/dsh-goal/types'
import type { SessionId } from '@voyaseek-ai/dsh-session'

/** Durable orchestration phase. Process-local activation is deliberately absent. */
export type ComplexGoalPhase = 'planning' | 'executing' | 'auditing' | 'paused' | 'blocked' | 'complete'

/** One bounded unit selected by the Manager. */
export interface ComplexGoalContract {
  readonly task: string
  readonly acceptance: readonly string[]
}

/** One deployment-owned command that must run under the read-only sandbox. */
export interface ComplexGoalVerificationGate {
  readonly id: string
  readonly command: string
  readonly timeoutMs: number
}

/** Persisted sandbox facts for one deterministic verification command. */
export interface ComplexGoalVerificationSandbox {
  readonly mode: 'read-only'
  readonly denied: boolean
  readonly enforcement?: 'full' | 'partial'
  readonly runnerFailed?: boolean
}

/** Bounded evidence from one deterministic verification command. */
export interface ComplexGoalVerificationGateResult {
  readonly id: string
  readonly command: string
  readonly status: 'passed' | 'failed' | 'timed-out' | 'runner-failed'
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stdout: string
  readonly stderr: string
  readonly stdoutTruncated: boolean
  readonly stderrTruncated: boolean
  readonly sandbox?: ComplexGoalVerificationSandbox
}

/** Host-owned deterministic evidence for one orchestration round. */
export interface ComplexGoalVerification {
  readonly round: number
  readonly status: 'passed' | 'failed'
  readonly gates: readonly ComplexGoalVerificationGateResult[]
}

/** Auditor-owned requirement status. */
export interface VerifiedRequirement {
  readonly requirement: string
  readonly status: 'satisfied' | 'pending' | 'blocked'
  readonly evidence: readonly string[]
}

/** Auditor-owned artifact status. */
export interface VerifiedArtifact {
  readonly artifact: string
  readonly status: 'verified' | 'missing' | 'suspect'
  readonly evidence: readonly string[]
}

/** State that may cross rounds only after an independent audit. */
export interface VerifiedComplexGoalState {
  readonly requirements: readonly VerifiedRequirement[]
  readonly artifacts: readonly VerifiedArtifact[]
  readonly facts: readonly string[]
}

/** Untrusted Executor report retained as claims for the next Auditor. */
export interface ComplexGoalExecution {
  readonly childId: SessionId
  readonly status: 'complete' | 'continue' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly blocker: string
}

/** Independent Auditor result. */
export interface ComplexGoalAudit {
  readonly childId: SessionId
  readonly status: 'complete' | 'continue' | 'blocked'
  readonly integrity: 'clean' | 'suspect' | 'violation'
  readonly alignment: 'aligned' | 'partial' | 'misaligned'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly missing: readonly string[]
  readonly nextTask: string
  readonly blocker: string
  readonly verifiedState: VerifiedComplexGoalState
}

/** Complete post-transition state carried by every durable change. */
export interface ComplexGoalSnapshot {
  readonly revision: number
  readonly goalId: GoalId
  readonly objective: string
  readonly startedAtMs: number
  readonly deadlineAtMs: number
  readonly phase: ComplexGoalPhase
  readonly round: number
  readonly maxRounds: number
  readonly verificationGates: readonly ComplexGoalVerificationGate[]
  readonly verificationOutputMaxBytes: number
  readonly trustedState: VerifiedComplexGoalState
  readonly contract?: ComplexGoalContract
  readonly latestExecution?: ComplexGoalExecution
  readonly latestVerification?: ComplexGoalVerification
  readonly latestAudit?: ComplexGoalAudit
  readonly resumeAt?: 'planning' | 'auditing'
  readonly blocker?: string
}

/** Why one complete snapshot was committed. */
export type ComplexGoalOperation = 'start' | 'manage' | 'execute' | 'verify' | 'audit' | 'interrupt' | 'resume' | 'block'

/** Durable whole-snapshot mutation. */
export interface ComplexGoalChange {
  readonly kind: 'complex-goal/change'
  readonly version: 2
  readonly operation: ComplexGoalOperation
  readonly snapshot: ComplexGoalSnapshot
}
