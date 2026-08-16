/**
 * The SDK query boundary owned by one driver. One engine instance holds the
 * deployment-resolved query inputs; each driver turn runs exactly one query
 * through it. The engine injects its query entry point in tests.
 * @module @deepseek-ai/dsh-claude-agent/engine
 */

import {
  query as officialQuery,
  type CanUseTool,
  type Options,
  type PermissionMode,
  type Query,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from './process.ts'

/** One SDK query submitted by a driver turn. */
export interface ClaudeQueryInput {
  /** Prompt text handed to the SDK. */
  prompt: string
  /** Workspace the SDK child runs in. */
  cwd: string
  /** SDK conversation id to resume, when the session already has one. */
  resume?: string
  /** Cancels the query and its child process tree. */
  signal: AbortSignal
  /** Receives every decoded SDK message in stream order, including the result. */
  onMessage: (message: SDKMessage) => void
}

/** Query outcome the driver folds into its turn-end record. */
export interface ClaudeQueryOutcome {
  /** Whether the SDK marked the run an error. */
  isError: boolean
  /** Human-readable failure detail for error outcomes, empty otherwise. */
  errorDetail: string
}

/** Deployment-resolved values one engine applies to every query. */
export interface ClaudeEngineConfig {
  /** Complete child environment, credentials already layered. */
  childEnv: Record<string, string>
  /** Model id handed to the SDK, when the deployment pins one. */
  model?: string
  /** SDK permission posture for the child. */
  permissionMode: PermissionMode
  /** DSH approval bridge; absent only under `bypassPermissions`. */
  canUseTool?: CanUseTool
  /** Explicit Claude Code executable; absent uses the SDK-distributed CLI. */
  executable?: string
  /** Process-tree termination grace in milliseconds. */
  disposeGraceMs: number
  /** Shared subprocess spawn operation. */
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** SDK query entry point; tests substitute a scripted stream. */
  query?: (input: { prompt: string; options: Options }) => Query
}

/**
 * Run one SDK query to completion over the shared subprocess seam.
 * Cancellation aborts the SDK controller, which terminates the child; the
 * subprocess handle remains the process-quiescence authority.
 */
export class SdkQueryEngine {
  constructor(private readonly config: ClaudeEngineConfig) {}

  /**
   * Execute one query and drain its complete stream.
   * @param input - prompt, workspace, resume identity, signal, and message sink.
   * @returns the folded result outcome; iterator and process failures throw.
   */
  async run(input: ClaudeQueryInput): Promise<ClaudeQueryOutcome> {
    if (input.signal.aborted) {
      throw input.signal.reason instanceof Error
        ? input.signal.reason
        : new Error('claude-agent: query aborted before start')
    }
    const controller = new AbortController()
    const forwardAbort = (): void => {
      if (!controller.signal.aborted) controller.abort(input.signal.reason)
    }
    input.signal.addEventListener('abort', forwardAbort, { once: true })
    let child: SubprocessHandle | undefined
    const options: Options = {
      abortController: controller,
      cwd: input.cwd,
      env: { ...this.config.childEnv },
      ...input.resume === undefined ? {} : { resume: input.resume },
      ...this.config.model === undefined ? {} : { model: this.config.model },
      permissionMode: this.config.permissionMode,
      ...this.config.permissionMode === 'bypassPermissions'
        ? { allowDangerouslySkipPermissions: true }
        : {},
      ...this.config.canUseTool === undefined ? {} : { canUseTool: this.config.canUseTool },
      ...this.config.executable === undefined ? {} : { pathToClaudeCodeExecutable: this.config.executable },
      spawnClaudeCodeProcess: (spawnOptions) => {
        const handle = this.config.spawn(claudeSpawnSpec(spawnOptions, this.config.disposeGraceMs))
        child = handle
        return new ManagedClaudeCodeProcess(handle)
      },
    }
    const query = (this.config.query ?? officialQuery)({ prompt: input.prompt, options })
    let outcome: ClaudeQueryOutcome = { isError: true, errorDetail: 'Claude Code ended without a result' }
    try {
      for await (const message of query) {
        input.onMessage(message)
        if (message.type !== 'result') continue
        const record = message as unknown as { subtype?: unknown; is_error?: unknown; errors?: unknown; result?: unknown }
        if (record.subtype === 'success' && record.is_error !== true) {
          outcome = { isError: false, errorDetail: '' }
        } else {
          const detail = Array.isArray(record.errors) && record.errors.length > 0
            ? record.errors.map(String).join('; ')
            : record.subtype === 'success' ? 'result marked as error' : String(record.subtype ?? 'unknown error')
          outcome = { isError: true, errorDetail: detail }
        }
      }
      return outcome
    } finally {
      input.signal.removeEventListener('abort', forwardAbort)
      try {
        query.close()
      } catch {
        // Swallows close-after-completion races: the stream already drained,
        // and a late close failure cannot change the produced outcome.
      }
      if (child !== undefined && child.pid > 0 && controller.signal.aborted) {
        child.terminate()
        try {
          await child.waitForExit()
        } catch {
          // Swallows termination-wait failures after an abort: the abort
          // reason already propagates through the rejected iterator.
        }
      }
    }
  }
}
