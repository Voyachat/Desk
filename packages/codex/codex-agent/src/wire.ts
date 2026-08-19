/** Codex app-server 0.147 JSON-RPC client for one persistent thread. */

import type { Readable, Writable } from 'node:stream'
import { JsonRpcLineTransport } from '@voyaseek-ai/dsh-sdk-protocol'

type JsonObject = Record<string, unknown>

/** Effective thread identity returned by app-server. */
export interface CodexThreadIdentity {
  readonly threadId: string
  readonly model?: string
  readonly modelProvider?: string
}

/** Terminal facts for one Codex turn. */
export interface CodexTurnOutcome {
  readonly status: 'completed' | 'failed' | 'interrupted'
  readonly error?: unknown
}

/** Transcript sink for one DSH step. */
export interface CodexTurnSink {
  /** Receive a visible or commentary delta. */
  onDelta(itemId: string | undefined, phase: 'text' | 'reasoning', text: string): void
  /** Receive a completed app-server item. */
  onItemCompleted(item: JsonObject): void
}

/** Host bridge for app-server requests that may authorize side effects. */
export type CodexServerRequestHandler = (
  method: string,
  params: JsonObject,
  signal: AbortSignal,
) => Promise<unknown>

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`codex-agent: app-server returned invalid ${label}`)
  }
  return value as JsonObject
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`codex-agent: app-server returned invalid ${label}`)
  }
  return value
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  return string(value, label)
}

function deltaText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`codex-agent: app-server returned invalid ${label}`)
  }
  return value
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

interface ActiveTurn {
  id?: string
  pendingId?: string
  readonly sink: CodexTurnSink
  readonly completion: PromiseWithResolvers<CodexTurnOutcome>
  readonly early: Array<{ method: string; params: JsonObject }>
  readonly signal: AbortSignal
}

/** One app-server connection serving one persistent Codex thread. */
export class CodexAppServerWire {
  private readonly transport: JsonRpcLineTransport
  private readonly fatal = Promise.withResolvers<never>()
  private threadId: string | undefined
  private active: ActiveTurn | undefined
  private closed = false

  constructor(
    private readonly input: Readable,
    output: Writable,
    private readonly serverRequest?: CodexServerRequestHandler,
  ) {
    this.transport = new JsonRpcLineTransport(input, output)
    void this.fatal.promise.catch(() => {})
    this.transport.onRequest((method, params) => this.handleServerRequest(method, params))
    this.transport.onNotification((method, params) => {
      try {
        this.handleNotification(method, params)
      } catch (error: unknown) {
        this.fail(thrown(error))
      }
    })
    this.input.on('end', this.onInputEnd)
    output.on('error', this.onOutputError)
  }

  /** Begin consuming newline-delimited app-server frames. */
  start(): void {
    this.transport.start()
  }

  /**
   * Perform the required initialize/initialized handshake.
   * @param signal - startup cancellation.
   */
  async initialize(signal: AbortSignal): Promise<void> {
    object(await this.guarded(this.transport.request('initialize', {
      clientInfo: { name: 'voyaseek-harness', title: 'Voyaseek Harness', version: '0.1.0' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }, signal), signal), 'initialize response')
    this.transport.notify('initialized')
    await this.guarded(this.transport.flush(), signal)
  }

  /**
   * Start a non-ephemeral thread or resume the durable identity.
   * @param input - workspace, optional durable identity and route, and cancellation.
   * @returns the validated effective thread identity.
   */
  async openThread(input: {
    cwd: string
    resume?: string
    model?: string
    modelProvider?: string
    signal: AbortSignal
  }): Promise<CodexThreadIdentity> {
    const params = input.resume === undefined
      ? {
          cwd: input.cwd,
          ephemeral: false,
          ...input.model === undefined ? {} : { model: input.model },
          ...input.modelProvider === undefined ? {} : { modelProvider: input.modelProvider },
        }
      : { threadId: input.resume }
    const method = input.resume === undefined ? 'thread/start' : 'thread/resume'
    const response = object(
      await this.guarded(this.transport.request(method, params, input.signal), input.signal),
      `${method} response`,
    )
    const thread = object(response.thread, `${method} thread`)
    const threadId = string(thread.id, `${method} thread id`)
    if (input.resume === undefined && thread.ephemeral === true) {
      throw new Error('codex-agent: app-server created an ephemeral main thread')
    }
    if (input.resume !== undefined && threadId !== input.resume) {
      throw new Error('codex-agent: thread/resume returned another thread')
    }
    this.threadId = threadId
    const reportedModel = optionalString(thread.model, `${method} model`) ?? input.model
    const reportedProvider = optionalString(thread.modelProvider, `${method} model provider`) ?? input.modelProvider
    return {
      threadId,
      ...reportedModel === undefined ? {} : { model: reportedModel },
      ...reportedProvider === undefined ? {} : { modelProvider: reportedProvider },
    }
  }

  /**
   * Submit one text turn and await its authoritative terminal notification.
   * @param input - text, request settings, transcript sink, and cancellation.
   * @returns completed, failed, or interrupted terminal facts.
   */
  async runTurn(input: {
    texts: readonly string[]
    sink: CodexTurnSink
    signal: AbortSignal
    developerInstructions?: string
    model?: string
    reasoningEffort?: string
  }): Promise<CodexTurnOutcome> {
    if (this.threadId === undefined) throw new Error('codex-agent: turn started before its thread')
    if (this.active !== undefined) throw new Error('codex-agent: concurrent turns are not supported')
    const active: ActiveTurn = {
      sink: input.sink,
      completion: Promise.withResolvers<CodexTurnOutcome>(),
      early: [],
      signal: input.signal,
    }
    this.active = active
    try {
      const response = object(await this.guarded(this.transport.request('turn/start', {
        threadId: this.threadId,
        input: input.texts.map(text => ({ type: 'text', text, text_elements: [] })),
        ...input.developerInstructions === undefined ? {} : { developerInstructions: input.developerInstructions },
        ...input.model === undefined ? {} : { model: input.model },
        ...input.reasoningEffort === undefined ? {} : { effort: input.reasoningEffort },
      }, input.signal), input.signal), 'turn/start response')
      const turn = object(response.turn, 'turn/start turn')
      this.commitTurnId(string(turn.id, 'turn/start turn id'))
      return await this.guarded(active.completion.promise, input.signal)
    } finally {
      if (this.active === active) this.active = undefined
    }
  }

  /** Best-effort remote interruption of the current turn. */
  interrupt(): void {
    const turnId = this.active?.id
    if (this.threadId === undefined || turnId === undefined || this.closed) return
    void this.transport.request('turn/interrupt', { threadId: this.threadId, turnId }).catch(() => {})
  }

  /** Close protocol listeners and reject outstanding operations. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.input.off('end', this.onInputEnd)
    this.transport.close()
    this.fail(new Error('codex-agent: app-server connection closed'))
  }

  private async guarded<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
    const guarded = Promise.race([pending, this.fatal.promise])
    if (signal.aborted) {
      void guarded.catch(() => {})
      throw this.abortError(signal)
    }
    let rejectAbort!: (error: Error) => void
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const onAbort = (): void => { rejectAbort(this.abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([guarded, aborted])
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error(`codex-agent: aborted: ${String(signal.reason)}`)
  }

  private fail(error: Error): void {
    this.fatal.reject(error)
  }

  private readonly onInputEnd = (): void => {
    this.fail(new Error('codex-agent: app-server protocol stream closed'))
  }

  private readonly onOutputError = (error: Error): void => {
    this.fail(error)
  }

  private observeTurnId(id: string): void {
    const active = this.active
    if (active === undefined) throw new Error('codex-agent: app-server referenced a turn before turn/start')
    if (active.pendingId !== undefined && active.pendingId !== id) {
      throw new Error('codex-agent: app-server referenced conflicting turns')
    }
    active.pendingId = id
  }

  private commitTurnId(id: string): void {
    const active = this.active
    if (active === undefined) throw new Error('codex-agent: turn/start response arrived without an active turn')
    if (active.pendingId !== undefined && active.pendingId !== id) {
      throw new Error('codex-agent: turn/start response did not match the active turn')
    }
    active.id = id
    const early = active.early.splice(0)
    for (const notification of early) this.handleNotification(notification.method, notification.params)
  }

  private validateIds(params: JsonObject, nullableTurn = false): boolean {
    if (params.threadId !== this.threadId) return false
    if (nullableTurn && params.turnId === null) return true
    const active = this.active
    if (active === undefined) throw new Error('codex-agent: server request arrived outside a turn')
    const id = string(params.turnId, 'server request turn id')
    if (active.id === undefined) {
      this.observeTurnId(id)
      return true
    }
    return id === active.id
  }

  private handleServerRequest(method: string, params: JsonObject): Promise<unknown> {
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval':
          if (!this.validateIds(params)) throw new Error('codex-agent: approval referenced another turn')
          if (this.serverRequest === undefined) return Promise.resolve({ decision: 'decline' })
          return this.serverRequest(method, params, this.activeSignal()).catch((error: unknown) => {
            const normalized = thrown(error)
            this.fail(normalized)
            throw normalized
          })
        case 'item/permissions/requestApproval':
          if (!this.validateIds(params)) throw new Error('codex-agent: permissions referenced another turn')
          return Promise.resolve({ permissions: {}, scope: 'turn' })
        case 'item/tool/requestUserInput':
          if (!this.validateIds(params)) throw new Error('codex-agent: user input referenced another turn')
          throw new Error('codex-agent: Codex user input is not yet supported')
        case 'mcpServer/elicitation/request':
          if (!this.validateIds(params, true)) throw new Error('codex-agent: elicitation referenced another thread')
          return Promise.resolve({ action: 'decline', content: null, _meta: null })
        default:
          throw new Error(`codex-agent: unsupported app-server request ${JSON.stringify(method)}`)
      }
    } catch (error: unknown) {
      const normalized = thrown(error)
      this.fail(normalized)
      return Promise.reject(normalized)
    }
  }

  private activeSignal(): AbortSignal {
    const signal = this.active?.signal
    if (signal === undefined) throw new Error('codex-agent: server request arrived outside a turn')
    return signal
  }

  private activeNotification(method: string, params: JsonObject): ActiveTurn | undefined {
    if (params.threadId !== this.threadId) return undefined
    const active = this.active
    if (active === undefined) return undefined
    const id = string(params.turnId, `${method} turn id`)
    if (active.id === undefined) {
      this.observeTurnId(id)
      active.early.push({ method, params })
      return undefined
    }
    return id === active.id ? active : undefined
  }

  private handleNotification(method: string, params: JsonObject): void {
    if (method === 'turn/started') {
      if (params.threadId !== this.threadId || this.active === undefined) return
      const turn = object(params.turn, 'turn/started turn')
      if (this.active.id === undefined) this.observeTurnId(string(turn.id, 'turn/started turn id'))
      return
    }
    if (method === 'item/agentMessage/delta') {
      const active = this.activeNotification(method, params)
      if (active === undefined) return
      const delta = deltaText(params.delta, 'agent message delta')
      if (delta.length > 0) active.sink.onDelta(optionalString(params.itemId, 'agent message item id'), 'text', delta)
      return
    }
    if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      const active = this.activeNotification(method, params)
      if (active === undefined) return
      const delta = deltaText(params.delta, 'reasoning delta')
      if (delta.length > 0) active.sink.onDelta(optionalString(params.itemId, 'reasoning item id'), 'reasoning', delta)
      return
    }
    if (method === 'item/completed') {
      const active = this.activeNotification(method, params)
      if (active === undefined) return
      active.sink.onItemCompleted(object(params.item, 'item/completed item'))
      return
    }
    if (method !== 'turn/completed') return
    if (params.threadId !== this.threadId) return
    const active = this.active
    if (active === undefined) return
    const turn = object(params.turn, 'turn/completed turn')
    const id = string(turn.id, 'turn/completed turn id')
    if (active.id === undefined) {
      this.observeTurnId(id)
      active.early.push({ method, params })
      return
    }
    if (id !== active.id) return
    if (turn.status !== 'completed' && turn.status !== 'failed' && turn.status !== 'interrupted') {
      throw new Error(`codex-agent: app-server returned invalid terminal turn status ${String(turn.status)}`)
    }
    active.completion.resolve({
      status: turn.status,
      ...turn.error === undefined || turn.error === null ? {} : { error: turn.error },
    })
  }
}
