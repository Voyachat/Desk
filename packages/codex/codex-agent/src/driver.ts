/** AgentDriver implementation backed by Codex app-server turns. */

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
import { deepFreeze, errorChain, type LlmCallConfig, type UserMessage } from '@voyaseek-ai/dsh-llm'
import { createScope, type Scope } from '@voyaseek-ai/dsh-scope'
import { canonicalHeader, headerEquals, type Session, type SessionId, type TurnEndReason } from '@voyaseek-ai/dsh-session'
import { joinContextSections, renderContextSections, renderPrompt } from '@voyaseek-ai/dsh-system-prompt'
import { CodexAppServerEngine } from './engine.ts'
import { CodexEventRecorder } from './mapping.ts'
import type {} from './types.ts'
import type { CodexServerRequestHandler } from './wire.ts'

type Phase =
  | { kind: 'idle' }
  | { kind: 'maintenance'; abort: AbortController }
  | { kind: 'running'; abort: AbortController; cause?: AgentCancelCause }

/** Deployment callbacks evaluated once per turn before the child is spawned. */
export interface CodexTurnConfig {
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly disposeGraceMs: number
}

/**
 * Recover the latest Codex thread binding from a durable session.
 * @param session - session whose events are scanned newest first.
 * @returns the latest binding, or `undefined` before thread creation.
 */
export function restoreCodexRuntime(session: Session): {
  threadId: string
  model?: string
  modelProvider?: string
} | undefined {
  const switched = session.events.findLast(candidate => candidate.type === 'agent/runtime/switched')
  const event = session.events.findLast(candidate => candidate.type === 'codex-agent/runtime')
  return event?.type === 'codex-agent/runtime' && (switched === undefined || event.seq > switched.seq)
    ? event.data
    : undefined
}

/**
 * Admit only non-empty text blocks across the Codex app-server boundary.
 * @param messages - user messages accepted by `agent/pre-step`.
 * @returns their text blocks in model input order, or an empty list for blank input.
 */
export function codexPromptTexts(messages: readonly UserMessage[]): string[] {
  const texts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== 'text') {
        throw new Error(`codex-agent: ${block.type} input is not supported; start a text-only Codex turn`)
      }
      texts.push(block.text)
    }
  }
  if (texts.every(text => text.trim().length === 0)) return []
  return texts
}

/** Driver for one DSH session and its recoverable Codex thread. */
export class CodexAgent implements AgentDriver {
  readonly inbox: Inbox
  readonly scope: Scope
  readonly ctx: Context
  readonly modelConstraint
  private readonly dispatch: AgentEventDispatch
  private phase: Phase = { kind: 'idle' }
  private activityDone: Promise<void> = Promise.resolve()
  private runtime: ReturnType<typeof restoreCodexRuntime>
  private requestHeaderLogged = false
  private readonly serverRequest: CodexServerRequestHandler
  private readonly runtimeContext: RuntimeContextProjection

  /** Bind one unpublished driver to its prepared session. */
  constructor(
    driverCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    private readonly engine: CodexAppServerEngine,
    private readonly resolveTurnConfig: (request: LlmCallConfig) => Promise<CodexTurnConfig>,
    private readonly cwd: string,
    private readonly configuredProvider: string,
    private readonly configuredModel: string,
    makeServerRequest: (agent: CodexAgent) => CodexServerRequestHandler = () => async () => ({ decision: 'decline' }),
    admittedModels?: readonly string[],
    admittedRoutes?: readonly AgentModelRouteConstraint[],
  ) {
    this.dispatch = agentEvents(driverCtx, this)
    this.scope = createScope(driverCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.runtime = restoreCodexRuntime(session)
    this.serverRequest = makeServerRequest(this)
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
    this.modelConstraint = {
      provider: configuredProvider,
      defaultModel: configuredModel,
      ...admittedModels === undefined ? {} : { models: [...admittedModels] },
      ...admittedRoutes === undefined ? {} : { routes: admittedRoutes.map(route => ({
        provider: route.provider,
        ...route.models === undefined ? {} : { models: [...route.models] },
      })) },
    }
    this.inbox = new Inbox(session, {
      inserted: (message) => { this.dispatch.emit('agent/inbox/inserted', { message }) },
      discarded: (message) => { this.dispatch.emit('agent/inbox/discarded', { message }) },
      claimed: (message, turn) => { this.dispatch.emit('agent/inbox/claimed', { message, turn }) },
    })
  }

  get status(): AgentStatus {
    return this.phase.kind === 'running' ? 'running' : 'idle'
  }

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
      if (cause.kind === 'disposed') {
        this.activityDone = this.activityDone.then(() => this.engine.dispose()).catch(() => {})
      }
      return
    }
    if (phase.kind === 'running') phase.cause ??= cause
    if (!phase.abort.signal.aborted) phase.abort.abort(cause)
    this.engine.cancelActive()
    if (options?.keepInbox !== true && this.inbox.hasPending) this.inbox.clear()
  }

  whenIdle(): Promise<void> {
    return this.activityDone
  }

  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" cannot run maintenance while ${this.phase.kind}`)
    const abort = new AbortController()
    this.setPhase({ kind: 'maintenance', abort })
    const run = Promise.resolve().then(() => task(abort.signal)).finally(() => {
      if (this.phase.kind === 'maintenance' && this.phase.abort === abort) this.setPhase({ kind: 'idle' })
    })
    this.activityDone = this.activityDone.then(() => run).then(() => undefined, () => undefined)
    return run
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    this.inbox.append(target, message)
    if (wakeup) this.wakeDriver()
  }

  followup(message: UserMessage): void { this.send(message, 'next-turn', true) }
  steer(message: UserMessage): void { this.send(message, 'next-step', true) }
  inject(message: UserMessage): void { this.send(message, 'next-step', false) }

  private wakeDriver(): void {
    if (this.phase.kind !== 'idle' || !this.inbox.hasPending) return
    const abort = new AbortController()
    this.setPhase({ kind: 'running', abort })
    this.activityDone = this.activityDone.then(async () => {
      try {
        while (!abort.signal.aborted && this.inbox.hasPending) await this.runOneTurn(abort)
      } finally {
        if (this.phase.kind === 'running' && this.phase.abort === abort) this.setPhase({ kind: 'idle' })
      }
    })
  }

  private lastTurn(): number {
    return this.session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
  }

  private async prepareMessages(
    claimed: UserMessage[],
    turn: number,
    step: number,
    signal: AbortSignal,
  ): Promise<{ decision: PreStepDecision; developerInstructions: string }> {
    const systemPrompt = this.ctx.get('systemPrompt')
    if (systemPrompt === undefined) throw new Error('codex-agent: no system-prompt service is composed')
    const assembly = await systemPrompt.assemble(assembleContextFor(this, signal))
    signal.throwIfAborted()
    const sections = renderContextSections(assembly)
    const context = this.runtimeContext.project(joinContextSections(sections), sections)
    const handoff = runtimeHandoffMessage(
      this.session,
      this.session.header.agentRuntime ?? 'codex',
      'codex-agent/runtime',
    )
    const messages = [
      ...(handoff === undefined ? [] : [handoff]),
      ...claimed,
      ...(context === undefined ? [] : [context]),
    ]
    const decision = await this.dispatch.waterfall(
      'agent/pre-step', { messages, turn, step, signal },
      () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages }),
    )
    signal.throwIfAborted()
    return { decision, developerInstructions: renderPrompt(assembly) }
  }

  private async requestConfig(
    turn: number,
    step: number,
    signal: AbortSignal,
    developerInstructions: string,
  ): Promise<LlmCallConfig> {
    const previous = this.session.requestHeader()
    const seed = deepFreeze(structuredClone(previous?.config ?? {
      provider: this.configuredProvider,
      model: this.options.model ?? this.configuredModel,
      ...this.options.maxTokens === undefined ? {} : { maxTokens: this.options.maxTokens },
    }))
    const config = await this.dispatch.waterfall(
      'agent/request', { turn, step, signal },
      () => Promise.resolve(seed),
    )
    signal.throwIfAborted()
    if (!config.provider || !config.model) {
      throw new Error(`agent "${this.id}" has no Codex provider/model`)
    }
    if (!modelConstraintAllows(this.modelConstraint, config.provider, config.model)) {
      throw new Error(`codex-agent: model "${config.model}" is not served by this Responses-compatible endpoint`)
    }
    const header = canonicalHeader({
      config,
      ...developerInstructions.length === 0 ? {} : { system: developerInstructions },
    })
    if (!this.requestHeaderLogged) {
      this.session.append('request/header', { header, reason: previous === undefined ? 'initial' : 'resume' })
      this.requestHeaderLogged = true
    } else if (previous === undefined || !headerEquals(previous, header)) {
      this.session.append('request/header', { header, reason: 'change' })
    }
    const requestContext = this.session.requestContext()
    if (requestContext?.provider !== config.provider || requestContext.model !== config.model) {
      this.session.append('request/context', { provider: config.provider, model: config.model })
    }
    return config
  }

  private async runOneTurn(abort: AbortController): Promise<void> {
    const turn = this.lastTurn() + 1
    const step = 1
    this.session.append('turn/start', { turn })
    let stepOpen = false
    let reason: TurnEndReason
    try {
      const claimed = this.inbox.claim('next-turn', turn)
      const prepared = await this.prepareMessages(claimed, turn, step, abort.signal)
      if (prepared.decision.kind === 'reject') {
        reason = { kind: 'blocked' }
      } else {
        const texts = codexPromptTexts(prepared.decision.messages)
        if (texts.length === 0) {
          reason = { kind: 'completed' }
        } else {
          this.session.append('step/start', { turn, step })
          stepOpen = true
          for (const message of prepared.decision.messages) {
            this.session.append('user/message', message, { surfaceOp: 'append' })
          }
          const request = await this.requestConfig(turn, step, abort.signal, prepared.developerInstructions)
          if (this.runtime?.modelProvider !== undefined && this.runtime.modelProvider !== request.provider) {
            throw new Error(`codex-agent: session thread uses provider "${this.runtime.modelProvider}"; start a new Codex conversation to use "${request.provider}"`)
          }
          const process = await this.resolveTurnConfig(request)
          const recorder = new CodexEventRecorder(this.session, turn, step, request.model, request.provider)
          const outcome = await this.engine.run({
            cwd: this.cwd,
            ...process,
            ...this.runtime === undefined ? {} : { resume: this.runtime.threadId },
            model: request.model,
            modelProvider: request.provider,
            ...request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort },
            ...prepared.developerInstructions.length === 0 ? {} : { developerInstructions: prepared.developerInstructions },
            texts,
            signal: abort.signal,
            sink: recorder,
            serverRequest: this.serverRequest,
            onThread: (identity) => {
              const runtime = {
                threadId: identity.threadId,
                model: request.model,
                modelProvider: request.provider,
              }
              if (this.runtime?.threadId !== runtime.threadId
                || this.runtime.model !== runtime.model
                || this.runtime.modelProvider !== runtime.modelProvider) {
                this.session.append('codex-agent/runtime', runtime)
              }
              this.runtime = runtime
            },
          })
          this.session.append('step/end', { turn, step })
          stepOpen = false
          if (outcome.turn.status === 'failed') {
            reason = {
              kind: 'error',
              error: {
                message: `Codex failed: ${JSON.stringify(outcome.turn.error ?? null)}`,
                code: 'CODEX_ERROR',
              },
            }
          } else if (outcome.turn.status === 'interrupted') {
            reason = { kind: 'error', error: { message: 'Codex interrupted the turn', code: 'CODEX_INTERRUPTED' } }
          } else {
            await this.dispatch.serial('agent/turn-stopping', { turn, signal: abort.signal })
            reason = { kind: 'completed' }
          }
        }
      }
    } catch (error: unknown) {
      if (stepOpen) this.session.append('step/end', { turn, step })
      if (abort.signal.aborted) {
        const cause = this.phase.kind === 'running' ? this.phase.cause : undefined
        reason = { kind: 'aborted', reason: cause ?? { kind: 'user' } }
      } else {
        reason = { kind: 'error', error: { message: errorChain(error), code: 'UNKNOWN' } }
      }
    }
    this.session.append('turn/end', { turn, reason })
  }
}
