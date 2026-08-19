/** One-turn process lifecycle over a durable Codex app-server thread. */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@voyaseek-ai/dsh-subprocess'
import { disposeCodexProcess } from './process.ts'
import {
  CodexAppServerWire,
  type CodexThreadIdentity,
  type CodexServerRequestHandler,
  type CodexTurnOutcome,
  type CodexTurnSink,
} from './wire.ts'

/** Inputs resolved afresh for each Codex turn. */
export interface CodexEngineRunInput {
  readonly cwd: string
  readonly argv: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly disposeGraceMs: number
  readonly resume?: string
  readonly model?: string
  readonly modelProvider?: string
  readonly reasoningEffort?: string
  readonly developerInstructions?: string
  readonly texts: readonly string[]
  readonly signal: AbortSignal
  readonly sink: CodexTurnSink
  readonly onThread: (identity: CodexThreadIdentity) => void
  readonly serverRequest?: CodexServerRequestHandler
}

/** Result of one process-isolated turn. */
export interface CodexEngineRunOutcome {
  readonly thread: CodexThreadIdentity
  readonly turn: CodexTurnOutcome
}

function thrown(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

/** App-server engine whose shared subprocess service owns every child tree. */
export class CodexAppServerEngine {
  private active: { wire: CodexAppServerWire; child: SubprocessHandle } | undefined

  /** @param spawn - shared subprocess spawn operation. */
  constructor(private readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle) {}

  /**
   * Run one turn in a fresh process, resuming the durable thread when known.
   * @param input - resolved process, thread, request, callback, and cancellation inputs.
   * @returns the effective thread identity and authoritative terminal turn facts.
   */
  async run(input: CodexEngineRunInput): Promise<CodexEngineRunOutcome> {
    if (this.active !== undefined) throw new Error('codex-agent: engine already has an active process')
    input.signal.throwIfAborted()
    const child = this.spawn({
      argv: input.argv,
      cwd: input.cwd,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65_536 } },
      graceMs: input.disposeGraceMs,
      env: input.env,
    })
    if (child.stdin === undefined || child.stdout === undefined) {
      await disposeCodexProcess(child)
      throw new Error('codex-agent: subprocess provider omitted app-server protocol pipes')
    }
    const wire = new CodexAppServerWire(child.stdout, child.stdin, input.serverRequest)
    const active = { wire, child }
    this.active = active
    const processFailure: Promise<never> = child.done.then(
      outcome => Promise.reject(new Error(
        `codex-agent: app-server exited during the turn (code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`,
      )),
      error => Promise.reject(thrown(error)),
    )
    void processFailure.catch(() => {})
    try {
      wire.start()
      await Promise.race([wire.initialize(input.signal), processFailure])
      const thread = await Promise.race([
        wire.openThread({
          cwd: input.cwd,
          ...input.resume === undefined ? {} : { resume: input.resume },
          ...input.model === undefined ? {} : { model: input.model },
          ...input.modelProvider === undefined ? {} : { modelProvider: input.modelProvider },
          signal: input.signal,
        }),
        processFailure,
      ])
      input.onThread(thread)
      const turn = await Promise.race([
        wire.runTurn({
          texts: input.texts,
          sink: input.sink,
          signal: input.signal,
          ...input.developerInstructions === undefined ? {} : { developerInstructions: input.developerInstructions },
          ...input.model === undefined ? {} : { model: input.model },
          ...input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort },
        }),
        processFailure,
      ])
      return { thread, turn }
    } finally {
      wire.close()
      await disposeCodexProcess(child)
      if (this.active === active) this.active = undefined
    }
  }

  /** Interrupt and terminate the current app-server tree. */
  cancelActive(): void {
    const active = this.active
    if (active === undefined) return
    active.wire.interrupt()
    active.child.terminate()
  }

  /** Await quiescence of any process still active during driver disposal. */
  async dispose(): Promise<void> {
    const active = this.active
    if (active === undefined) return
    active.wire.interrupt()
    active.wire.close()
    await disposeCodexProcess(active.child)
    if (this.active === active) this.active = undefined
  }
}
