/**
 * The Claude Agent SDK driver: one {@link AgentDriver} implementation whose
 * turns hand the claimed prompt to an official SDK query and project the
 * SDK's transcript into the durable session events the DSH surface renders.
 * The SDK child owns tool execution; the driver owns DSH turn/step structure,
 * cancellation, and inbox semantics.
 * @module @voyaseek-ai/dsh-claude-agent/driver
 */

import type { Context } from '@voyaseek-ai/cordis'
import type {
  AgentCancelCause,
  AgentModelRouteConstraint,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  InboxTarget,
  PreStepDecision,
} from '@voyaseek-ai/dsh-agent'
import { Inbox, agentEvents, assembleContextFor, modelConstraintAllows, type AgentEventDispatch } from '@voyaseek-ai/dsh-agent'
import { RuntimeContextProjection, runtimeHandoffMessage, type AgentDriver } from '@voyaseek-ai/dsh-agent-loop'
import { errorChain } from '@voyaseek-ai/dsh-llm'
import type { LlmCallConfig, LlmFailure, UserMessage } from '@voyaseek-ai/dsh-llm'
import { createScope, type Scope } from '@voyaseek-ai/dsh-scope'
import type { EpochHeader, Session, SessionId, TurnEndReason } from '@voyaseek-ai/dsh-session'
import { canonicalHeader, headerEquals } from '@voyaseek-ai/dsh-session'
import { joinContextSections, renderContextSections, renderPrompt } from '@voyaseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@voyaseek-ai/dsh-system-prompt'
import type { SdkQueryEngine } from './engine.ts'
import { SdkEventRecorder } from './mapping.ts'
import type {} from './types.ts'

type Phase =
  | { kind: 'idle' }
  | { kind: 'maintenance'; abort: AbortController }
  | { kind: 'running'; abort: AbortController; cause?: AgentCancelCause }

/**
 * Concatenate the text of one claimed batch into the single SDK prompt.
 * @param messages - claimed user messages in claim order.
 * @returns their text blocks joined by blank lines.
 */
export function promptText(messages: readonly UserMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') {
        throw new Error(`claude-agent: input block "${block.type}" is not supported by the Claude SDK text prompt bridge`)
      }
      parts.push(block.text)
    }
  }
  return parts.join('\n\n')
}

/**
 * Restore the latest Claude-side conversation id recorded in a log.
 * @param session - the session whose events are scanned, newest first.
 * @returns the last recorded SDK session id, or `undefined` before the first.
 */
export function restoreClaudeSessionId(session: Session): string | undefined {
  const switched = session.events.findLast(candidate => candidate.type === 'agent/runtime/switched')
  const event = session.events.findLast(candidate => candidate.type === 'claude-agent/runtime')
  return event?.type === 'claude-agent/runtime' && (switched === undefined || event.seq > switched.seq)
    ? event.data.claudeSessionId
    : undefined
}

/** Flatten an unknown driver failure into the durable turn-end shape. */
function failureOf(error: unknown): LlmFailure {
  return { message: errorChain(error), code: 'UNKNOWN' }
}

/**
 * Agent driver that delegates the programming loop to the official Claude
 * Agent SDK. Each wake drains queued turns; one turn claims its prompt,
 * opens one step, runs one SDK query resumed on the recorded SDK session id,
 * and closes with the query outcome. Status, inbox, and cancellation follow
 * the default driver's public contract.
 */
export class ClaudeSdkAgent implements AgentDriver {
  readonly inbox: Inbox
  readonly scope: Scope
  readonly ctx: Context
  private readonly dispatch: AgentEventDispatch
  private readonly engine: SdkQueryEngine
  private phase: Phase = { kind: 'idle' }
  private activityDone: Promise<void> = Promise.resolve()
  private claudeSessionId: string | undefined
  private requestHeaderLogged = false
  private readonly runtimeContext: RuntimeContextProjection
  readonly modelConstraint

  /**
   * Bind one driver to its session.
   * @param driverCtx - context the driver's scope and event dispatch root in.
   * @param id - the shared agent/session identity.
   * @param options - per-agent options recorded on the published agent.
   * @param session - the prepared session this driver owns.
   * @param runtimeId - configured runtime id this driver matches in switch events.
   * @param engineFactory - builds the query engine once the agent exists, so the approval bridge can cite it.
   * @param cwd - workspace handed to every SDK child.
   * @param runtimeProvider - only provider route this Claude endpoint can serve.
   * @param defaultModel - deployment model used before a global selection exists.
   * @param childEnv - resolves credentials and endpoint variables for the selected model on each turn.
   */
  constructor(
    driverCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    private readonly runtimeId: string,
    engineFactory: (agent: ClaudeSdkAgent) => SdkQueryEngine,
    private readonly cwd: string,
    private readonly runtimeProvider: string,
    private readonly defaultModel: string | undefined = runtimeProvider,
    private readonly childEnv: (request: LlmCallConfig) => Promise<Record<string, string> | undefined> = async () => undefined,
    admittedModels?: readonly string[],
    admittedRoutes?: readonly AgentModelRouteConstraint[],
  ) {
    this.dispatch = agentEvents(driverCtx, this)
    this.scope = createScope(driverCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.inbox = new Inbox(session, {
      inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }) },
      discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }) },
      claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }) },
    })
    this.claudeSessionId = restoreClaudeSessionId(session)
    this.engine = engineFactory(this)
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
    this.modelConstraint = {
      provider: runtimeProvider,
      defaultModel: defaultModel ?? runtimeProvider,
      ...admittedModels === undefined ? {} : { models: [...admittedModels] },
      ...admittedRoutes === undefined ? {} : { routes: admittedRoutes.map(route => ({
        provider: route.provider,
        ...route.models === undefined ? {} : { models: [...route.models] },
      })) },
    }
  }

  get status(): AgentStatus {
    return this.phase.kind === 'running' ? 'running' : 'idle'
  }

  /** Commit a phase and publish the externally visible status transition. */
  private setPhase(next: Phase): void {
    const previous = this.status
    this.phase = next
    const status = this.status
    if (status !== previous) this.dispatch.emit('agent/status', { status })
  }

  cancel(cause: AgentCancelCause, options?: CancelOptions): void {
    const phase = this.phase
    if (phase.kind === 'idle') {
      if (options?.keepInbox !== true && this.inbox.hasPending) this.inbox.clear()
      return
    }
    if (phase.kind === 'running') phase.cause ??= cause
    if (!phase.abort.signal.aborted) {
      phase.abort.abort(new Error(`agent "${this.id}" cancelled`))
    }
    if (options?.keepInbox !== true && this.inbox.hasPending) this.inbox.clear()
  }

  whenIdle(): Promise<void> {
    return this.activityDone
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') {
      throw new Error(`agent "${this.id}" cannot run maintenance while ${this.phase.kind}`)
    }
    const abort = new AbortController()
    this.setPhase({ kind: 'maintenance', abort })
    const run = Promise.resolve()
      .then(() => task(abort.signal))
      .finally(() => {
        if (this.phase.kind === 'maintenance' && this.phase.abort === abort) {
          this.setPhase({ kind: 'idle' })
        }
      })
    this.activityDone = this.activityDone.then(() => run).then(() => undefined, () => undefined)
    return run
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    this.inbox.append(target, message)
    if (wakeup) this.wakeDriver()
  }

  followup(message: UserMessage): void {
    this.send(message, 'next-turn', true)
  }

  steer(message: UserMessage): void {
    this.send(message, 'next-step', true)
  }

  inject(message: UserMessage): void {
    this.send(message, 'next-step', false)
  }

  /** Start the drain activity when idle input is waiting. */
  private wakeDriver(): void {
    if (this.phase.kind !== 'idle' || !this.inbox.hasPending) return
    const abort = new AbortController()
    this.setPhase({ kind: 'running', abort })
    this.activityDone = this.activityDone.then(async () => {
      try {
        await this.drain(abort)
      } finally {
        if (this.phase.kind === 'running' && this.phase.abort === abort) {
          this.setPhase({ kind: 'idle' })
        }
      }
    })
  }

  /** Run turns until cancellation or the inbox empties. */
  private async drain(abort: AbortController): Promise<void> {
    while (!abort.signal.aborted && this.inbox.hasPending) {
      await this.runOneTurn(abort)
    }
  }

  /** The highest turn number recorded in the log, 0 before the first turn. */
  private lastTurn(): number {
    return this.session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
  }

  /** Rebuild the next request proposal from durable state and current defaults. */
  private requestProposal(): LlmCallConfig {
    const persisted = this.session.requestHeader()?.config
    if (persisted !== undefined) return persisted
    return {
      provider: this.options.provider ?? this.runtimeProvider,
      model: this.options.model ?? this.defaultModel ?? '',
      ...this.options.maxTokens === undefined ? {} : { maxTokens: this.options.maxTokens },
    }
  }

  /** Log the exact non-history request envelope handed to the SDK. */
  private logRequestHeader(header: EpochHeader): void {
    const baseline = this.session.requestHeader()
    if (!this.requestHeaderLogged) {
      this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' })
      this.requestHeaderLogged = true
    } else if (baseline === undefined || !headerEquals(baseline, header)) {
      this.session.append('request/header', { header, reason: 'change' })
    }
  }

  /** Run one claimed-prompt turn through exactly one SDK query. */
  private async runOneTurn(abort: AbortController): Promise<void> {
    const turn = this.lastTurn() + 1
    this.session.append('turn/start', { turn })
    let reason: TurnEndReason
    let stepOpen = false
    try {
      const claimed = this.inbox.claim('next-turn', turn)
      const step = 1
      const systemPromptService = this.ctx.get('systemPrompt')
      const assembly: PromptAssembly = systemPromptService === undefined
        ? { sections: [], contexts: [], tools: [], variables: {} }
        : await systemPromptService.assemble(assembleContextFor(this, abort.signal))
      const sections = renderContextSections(assembly)
      const context = this.runtimeContext.project(joinContextSections(sections), sections)
      const handoff = runtimeHandoffMessage(
        this.session,
        this.runtimeId,
        'claude-agent/runtime',
      )
      const proposed = [
        ...(handoff === undefined ? [] : [handoff]),
        ...claimed,
        ...(context === undefined ? [] : [context]),
      ]
      const decision = await this.dispatch.waterfall(
        'agent/pre-step',
        { messages: claimed, turn, step, signal: abort.signal },
        (): Promise<PreStepDecision> => Promise.resolve({
          kind: 'enter',
          messages: proposed,
        }),
      )
      abort.signal.throwIfAborted()
      if (decision.kind === 'reject') {
        reason = { kind: 'completed' }
      } else {
        const prompt = promptText(decision.messages)
        if (prompt.trim().length === 0) {
          reason = { kind: 'completed' }
          this.session.append('turn/end', { turn, reason })
          return
        }
        this.session.append('step/start', { turn, step })
        stepOpen = true
        for (const message of decision.messages) {
          this.session.append('user/message', message, { surfaceOp: 'append' })
        }
        const config = await this.dispatch.waterfall(
          'agent/request',
          { turn, step, signal: abort.signal },
          () => Promise.resolve(this.requestProposal()),
        )
        abort.signal.throwIfAborted()
        if (!config.provider || !config.model) {
          throw new Error(`agent "${this.id}" has no provider/model for Claude mode`)
        }
        if (!modelConstraintAllows(this.modelConstraint, config.provider, config.model)) {
          throw new Error(`claude-agent: model "${config.model}" is not served by this Anthropic-compatible endpoint`)
        }
        const previousProvider = this.session.requestHeader()?.config.provider
        if (this.claudeSessionId !== undefined && previousProvider !== undefined && previousProvider !== config.provider) {
          throw new Error(`claude-agent: session thread uses provider "${previousProvider}"; start a new Claude conversation to use "${config.provider}"`)
        }
        const systemPrompt = renderPrompt(assembly)
        this.logRequestHeader(canonicalHeader({ config, ...systemPrompt.length === 0 ? {} : { system: systemPrompt } }))
        const recorder = new SdkEventRecorder(this.session, turn, step, config.model, (claudeSessionId, model) => {
          this.claudeSessionId = claudeSessionId
          this.session.append('claude-agent/runtime', {
            claudeSessionId,
            ...model === undefined ? {} : { model },
          })
        })
        const childEnv = await this.childEnv(config)
        const outcome = await this.engine.run({
          prompt,
          cwd: this.cwd,
          model: config.model,
          ...systemPrompt.length === 0 ? {} : { systemPrompt },
          ...childEnv === undefined ? {} : { childEnv },
          ...this.claudeSessionId === undefined ? {} : { resume: this.claudeSessionId },
          signal: abort.signal,
          onMessage: (message) => { recorder.apply(message) },
        })
        this.session.append('step/end', { turn, step })
        stepOpen = false
        reason = outcome.isError
          ? { kind: 'error', error: { message: `Claude Code failed: ${outcome.errorDetail}`, code: 'CLAUDE_ERROR' } }
          : { kind: 'completed' }
      }
    } catch (error: unknown) {
      if (stepOpen) this.session.append('step/end', { turn, step: 1 })
      if (abort.signal.aborted) {
        const cause = this.phase.kind === 'running' ? this.phase.cause : undefined
        reason = { kind: 'aborted', reason: cause ?? { kind: 'user' } }
      } else {
        reason = { kind: 'error', error: failureOf(error) }
      }
    }
    this.session.append('turn/end', { turn, reason })
  }
}
