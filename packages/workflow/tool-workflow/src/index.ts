/**
 * The model-facing `workflow` tool: run a JavaScript orchestration script that fans out
 * subagents, and return the script's final value. It owns the model-facing schema and run lifecycle; script
 * parsing, execution, caps, and cancellation live behind `ctx.workflowEngine`
 * (`@voyaseek-ai/dsh-workflow`), so a hardened engine swaps in without touching what the model
 * sees. Execution awaits `run.result` and always disposes the run; non-completed reasons become tool
 * errors, and background collection remains deferred. Presentation is an args-only generic card
 * titled from `meta.name`. Explicit-ask usage guidance is registered as the tool's own prompt
 * section rather than deployment persona prose.
 * @module @voyaseek-ai/dsh-tool-workflow
 */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import type { CommandResult } from '@voyaseek-ai/dsh-commands'
import { defineTool } from '@voyaseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@voyaseek-ai/dsh-tools'
import type { CallId, ContentBlock } from '@voyaseek-ai/dsh-llm'
import type { JsonValue, Session, SessionEventMap } from '@voyaseek-ai/dsh-session'
import type {
  WorkflowResult, WorkflowRun, WorkflowRunId, WorkflowStopReason,
} from '@voyaseek-ai/dsh-workflow'
import type {
  ToolWorkflowAgentEndData, ToolWorkflowAgentStartData,
  ToolWorkflowRunEndData, ToolWorkflowRunStartData,
} from './types.ts'
// Declaration merge only: makes ctx.systemPrompt visible for the section registration.
import type {} from '@voyaseek-ai/dsh-system-prompt'

export const name = 'tool-workflow'
export const inject = ['tools', 'workflowEngine', 'systemPrompt']

const RETRY_COMMAND = 'workflow-retry'

/** Config: the model-facing tool name plus result rendering caps. */
export interface Config {
  /** The model-facing tool name to register (default `workflow`). */
  toolName?: string
  /** Rendered-result ceiling, in characters: a longer JSON value is truncated with a notice (default 50000). */
  maxResultChars?: number
}

export const Config: z<Config> = z.object({
  toolName: z.string().default('workflow'),
  maxResultChars: z.natural().min(1).default(50_000),
})

type ResolvedConfig = Required<Config>

interface WorkflowRecorder {
  start(session: Session, run: WorkflowRun, callId: CallId): void
  finish(runId: WorkflowRunId, stopReason: WorkflowStopReason): void
  abandon(runId: WorkflowRunId): void
}

interface ToolWorkflowRecordEventMap {
  'tool-workflow/run-start': ToolWorkflowRunStartData
  'tool-workflow/agent-start': ToolWorkflowAgentStartData
  'tool-workflow/agent-end': ToolWorkflowAgentEndData
  'tool-workflow/run-end': ToolWorkflowRunEndData
}

/** Render a contained recording failure without trusting the thrown value. */
function renderRecordingError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

/**
 * Project active top-level workflow runs into their parent Sessions without
 * letting recording failure affect tool execution.
 */
function createWorkflowRecorder(ctx: Context): WorkflowRecorder {
  const active = new Map<WorkflowRunId, Session>()
  const append = <Type extends keyof ToolWorkflowRecordEventMap>(
    session: Session,
    type: Type,
    data: SessionEventMap[Type],
  ): boolean => {
    // These four package-owned events are all log-only. Narrowing the generic
    // append face here discharges Session.append's conditional options tuple.
    const appendRecord = session.append.bind(session) as <Event extends keyof ToolWorkflowRecordEventMap>(
      event: Event,
      value: SessionEventMap[Event],
    ) => void
    try {
      appendRecord(type, data)
      return true
    } catch (error: unknown) {
      ctx.logger.warn(`tool-workflow: disabled durable record after ${type} append failed: ${renderRecordingError(error)}`)
      return false
    }
  }

  ctx.on('workflow/agent-start', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    const data: ToolWorkflowAgentStartData = {
      runId: info.id,
      seq: agent.seq,
      label: agent.label,
      ...agent.phase === undefined ? {} : { phase: agent.phase },
      childId: agent.childId,
    }
    if (!append(session, 'tool-workflow/agent-start', data)) active.delete(info.id)
  })
  ctx.on('workflow/agent-end', (info, agent) => {
    const session = active.get(info.id)
    if (session === undefined) return
    const data: ToolWorkflowAgentEndData = {
      runId: info.id,
      seq: agent.seq,
      outcome: agent.outcome,
    }
    if (!append(session, 'tool-workflow/agent-end', data)) active.delete(info.id)
  })

  return {
    start(session, run, callId) {
      if (append(session, 'tool-workflow/run-start', { runId: run.id, callId, name: run.meta.name })) {
        active.set(run.id, session)
      }
    },
    finish(runId, stopReason) {
      const session = active.get(runId)
      if (session !== undefined) append(session, 'tool-workflow/run-end', { runId, stopReason })
      active.delete(runId)
    },
    abandon: (runId) => { active.delete(runId) },
  }
}

interface RecoverableRun {
  readonly runId: WorkflowRunId
  readonly openMembers: Set<number>
}

/**
 * Close workflow records left open by the previous process. The session log
 * is the authority: recovery appends explicit interrupted endings and never
 * replays model-authored code or reports completion.
 */
function recoverInterruptedRuns(session: Session): void {
  const open = new Map<WorkflowRunId, RecoverableRun>()
  for (const event of session.events) {
    if (event.type === 'tool-workflow/run-start') {
      open.set(event.data.runId, { runId: event.data.runId, openMembers: new Set() })
      continue
    }
    if (event.type === 'tool-workflow/agent-start') {
      open.get(event.data.runId)?.openMembers.add(event.data.seq)
      continue
    }
    if (event.type === 'tool-workflow/agent-end') {
      open.get(event.data.runId)?.openMembers.delete(event.data.seq)
      continue
    }
    if (event.type === 'tool-workflow/run-end') open.delete(event.data.runId)
  }

  for (const run of open.values()) {
    for (const seq of [...run.openMembers].sort((left, right) => left - right)) {
      session.append('tool-workflow/agent-end', { runId: run.runId, seq, outcome: 'interrupted' })
    }
    session.append('tool-workflow/run-end', { runId: run.runId, stopReason: 'interrupted' })
  }
}

type RetrySource = {
  readonly callId: CallId
  readonly args: WorkflowCallArgs
}

/** Read one exact restart source from the authoritative Session log. */
function retrySource(session: Session, rawRunId: string, toolName: string): RetrySource | CommandResult {
  const runId = rawRunId.trim()
  if (runId.length === 0 || /\s/u.test(runId)) {
    return { kind: 'error', text: `Usage: /${RETRY_COMMAND} <runId>` }
  }

  let start: ToolWorkflowRunStartData | undefined
  let terminal: ToolWorkflowRunEndData['stopReason'] | undefined
  for (const event of session.events) {
    if (event.type === 'tool-workflow/run-start' && String(event.data.runId) === runId) start = event.data
    if (event.type === 'tool-workflow/run-end' && String(event.data.runId) === runId) terminal = event.data.stopReason
  }
  if (start === undefined) return { kind: 'error', text: `Workflow run "${runId}" was not found.` }
  if (terminal !== 'error' && terminal !== 'interrupted') {
    return { kind: 'error', text: terminal === undefined
      ? `Workflow run "${runId}" is not durably interrupted.`
      : `Workflow run "${runId}" is ${terminal} and cannot be retried.` }
  }

  const source = session.events.find(event => (
    event.type === 'tool/call' && event.data.callId === start.callId
  ))
  if (source?.type !== 'tool/call' || source.data.name !== toolName) {
    return { kind: 'error', text: `Workflow run "${runId}" has no available source call.` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source.data.arguments)
  } catch {
    return { kind: 'error', text: `Workflow run "${runId}" has invalid source arguments.` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'error', text: `Workflow run "${runId}" has invalid source arguments.` }
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.script !== 'string'
    || record.meta === null || typeof record.meta !== 'object' || Array.isArray(record.meta)
    || (record.args !== undefined
      && (record.args === null || typeof record.args !== 'object' || Array.isArray(record.args)))) {
    return { kind: 'error', text: `Workflow run "${runId}" has invalid source arguments.` }
  }
  return {
    callId: start.callId,
    args: {
      script: record.script,
      meta: record.meta as WorkflowCallArgs['meta'],
      ...record.args === undefined ? {} : { args: record.args as Record<string, unknown> },
    },
  }
}

/**
 * The script-authoring contract, embedded in the tool description. This IS the
 * model-facing spec: the meta block, the hooks and their exact semantics, and
 * the supported schema subset.
 */
const DESCRIPTION = `Run a JavaScript workflow script that orchestrates subagents at scale. Use this for work that fans out across many independent pieces — an audit over many files, a migration, multi-angle research, adversarial verification of findings — where you write the orchestration as a script instead of delegating turn by turn.

The workflow's identity rides the \`meta\` parameter as JSON: required \`name\` (short kebab-case) and \`description\` strings, optional \`whenToUse\` string and \`phases\` array (\`{title, detail?, provider?, model?}\`). The \`script\` parameter is the plain JavaScript body ONLY (NOT TypeScript, and NO \`export const meta\` statement — meta is a parameter, not code), running with top-level await; end with \`return <value>\` — the value must be JSON-serializable and is this tool's result.

Script-body hooks:
- \`agent(prompt, opts?): Promise<any>\` — run one subagent to completion. Without \`opts.schema\` it resolves to the child's final text; with \`opts.schema\` (an object-rooted JSON Schema using ONLY type/properties/required/additionalProperties/items/enum/const/oneOf — no pattern/format/numeric bounds) it resolves to the validated object. Resolves \`null\` when the child fails (filter with \`.filter(Boolean)\`). Other opts: \`label\` (display), \`phase\` (progress group), and independent \`provider\`/\`model\` LLM target overrides (either may be provided alone). Anything else (\`effort\`/\`isolation\`/\`agentType\`) is rejected loudly.
- \`pipeline(items, ...stages): Promise<any[]>\` — run each item through the stages independently with NO barrier between stages (prefer this for multi-stage work). Each stage receives \`(prev, item, index)\`. An ordinary stage throw drops that ITEM to \`null\` and skips its remaining stages.
- \`parallel(thunks): Promise<any[]>\` — run zero-argument functions concurrently and await ALL of them (a barrier; use only when a stage genuinely needs every prior result together). A throwing thunk resolves to \`null\`.
- \`phase(title)\` — start a progress phase; \`log(message)\` — narrate progress; \`args\` — the tool call's \`args\` input, verbatim.

Misused hooks (bad arguments, unknown options, unsupported schemas, tripped caps) throw errors that ALWAYS kill the script — they never dissolve into a per-item \`null\`.

Constraints: concurrency and total-agent caps apply; no filesystem, network, timers, or Node.js APIs are provided — the agents do the work, the script only coordinates them. The run executes in the foreground: this call returns when the whole script finishes.`

type WorkflowCallArgs = {
  script: string
  meta: {
    name: string
    description: string
    whenToUse?: string
    phases?: { title: string; detail?: string; provider?: string; model?: string }[]
  }
  args?: Record<string, unknown>
}

/** The pending-state card: a generic card titled by the workflow's meta name. */
function presentWorkflowCall(args: WorkflowCallArgs): ToolCallView {
  return {
    card: 'generic',
    title: `workflow: ${args.meta.name}`,
    rawInput: args.script,
  }
}

/** The completed-state card: keep the pending title; render the result content as-is. */
function presentWorkflowResult(args: WorkflowCallArgs, result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  void args
  void result
  return { card: 'generic' }
}

/** A non-`completed` stop reason means the script did not finish cleanly. */
function stopReasonError(result: WorkflowResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'cancelled':
      return `workflow run was cancelled${result.error !== undefined ? ` (${result.error})` : ''}`
    case 'error':
      return `workflow run failed: ${result.error ?? 'unknown error'}`
    /* v8 ignore start -- defensive: WorkflowStopReason is a closed union, exhaustive by construction; a future variant fails here loudly */
    default:
      return `workflow run ended abnormally (${String(result.stopReason satisfies never)})`
    /* v8 ignore stop */
  }
}

/** Render the run's outcome text: the meta name, agent count, and the JSON value (capped). */
function renderResult(name: string, agentsStarted: number, value: JsonValue, maxChars: number): string {
  // The engine returns JSON data (null for a valueless script), so stringify never yields undefined.
  const rendered = JSON.stringify(value, null, 2)
  const clipped = rendered.length > maxChars
    ? `${rendered.slice(0, maxChars)}\n… [truncated: ${rendered.length - maxChars} more characters]`
    : rendered
  return `workflow "${name}" completed (${agentsStarted} agent${agentsStarted === 1 ? '' : 's'}).\nReturn value:\n${clipped}`
}

export function apply(ctx: Context, config: Config): void {
  // schemastery (the exported Config schema) has already filled the defaulted
  // fields; the assertion records that resolution, not a hidden fallback.
  const { toolName, maxResultChars } = config as ResolvedConfig
  const recorder = createWorkflowRecorder(ctx)
  ctx.on('agent/session-start', ({ agent, source }) => {
    if (source === 'resume') recoverInterruptedRuns(agent.session)
  })
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: RETRY_COMMAND,
      description: 'restart an interrupted or failed workflow from its logged source call',
      input: { hint: '<runId>' },
      handler: async (invocation) => {
        const source = retrySource(invocation.agent.session, invocation.rawInput, toolName)
        if ('kind' in source) return source

        const run = ctx.workflowEngine.start({
          script: source.args.script,
          meta: source.args.meta,
          ...source.args.args === undefined ? {} : { args: source.args.args },
          parent: invocation.agent,
          signal: invocation.signal,
        })
        recorder.start(invocation.agent.session, run, source.callId)
        const onAbort = (): void => { run.cancel('workflow retry command aborted') }
        invocation.signal.addEventListener('abort', onAbort, { once: true })

        let result: WorkflowResult | undefined
        try {
          result = await run.result
        } finally {
          invocation.signal.removeEventListener('abort', onAbort)
          try {
            await run.dispose()
            // WorkflowRun.result never rejects, so assignment precedes this finally by contract.
            recorder.finish(run.id, (result as WorkflowResult).stopReason)
          } finally {
            recorder.abandon(run.id)
          }
        }

        return result.stopReason === 'completed'
          ? {
              kind: 'success',
              text: `Workflow "${run.meta.name}" restarted from the beginning and completed as run ${run.id}.`,
            }
          : {
              kind: 'error',
              text: `Workflow "${run.meta.name}" restart ended ${result.stopReason}${result.error === undefined ? '.' : `: ${result.error}`}`,
            }
      },
    })
  })
  // Usage policy ships with the tool (the master convention: tool guidance
  // lives in tool plugins as prompt sections, not in the deployment persona).
  ctx.systemPrompt.section({
    name: `tool:${toolName}`,
    order: 115,
    text: `Use the ${toolName} tool ONLY when the user explicitly asks for a workflow or for large multi-agent orchestration: you write a JavaScript script (the tool description documents the exact format) that fans work out across many subagents with phases and structured results. For one or two delegations, prefer plain subagent calls.`,
  })
  ctx.tools.register(defineTool({
    name: toolName,
    description: DESCRIPTION,
    parameters: {
      script: {
        type: 'string',
        required: true,
        description: 'The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`).',
      },
      meta: {
        type: 'object',
        additionalProperties: true,
        required: true,
        description: 'The workflow identity block (plain JSON — never code).',
        properties: {
          name: { type: 'string', required: true, description: 'Short kebab-case workflow name.' },
          description: { type: 'string', required: true, description: 'One-line description of what the workflow does.' },
          whenToUse: { type: 'string', description: 'Optional guidance on when this workflow applies.' },
          phases: {
            type: 'array',
            description: 'Optional phase declarations matched by phase() calls.',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                title: { type: 'string', required: true, description: 'The phase title phase() calls match by exact string.' },
                detail: { type: 'string', description: 'Optional one-line description of the phase.' },
                provider: { type: 'string', description: 'Optional provider override this phase is expected to use.' },
                model: { type: 'string', description: 'Optional model override this phase is expected to use.' },
              },
            },
          },
        },
      },
      args: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {"files": [...]}).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          agentsStarted: { type: 'integer', required: true },
          result: { type: 'json', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: renderResult(args.meta.name, value.agentsStarted, value.result, maxResultChars),
      }],
    },
    async execute(args, exec) {
      const parent = exec.agent
      if (!parent) {
        // The loop sets `exec.agent` for every model-driven call; its absence
        // means a non-agent caller invoked the tool directly, which has no
        // parent to attribute the children to. Fail loud rather than guess.
        throw new Error('workflow tool requires a calling agent (exec.agent was undefined)')
      }

      // Meta/body validation failures (META_INVALID/SCRIPT_PARSE) throw
      // synchronously here and become isError results via the registry — the
      // model sees the violation list and can correct the call.
      const run = ctx.workflowEngine.start({
        script: args.script,
        meta: args.meta,
        ...args.args !== undefined ? { args: args.args } : {},
        parent,
        signal: exec.signal,
      })
      const recordsRun = exec.parent === undefined
      // The shipped worker-thread engine publishes member events from later
      // worker messages, after start() returns and this run record is active.
      if (recordsRun) recorder.start(parent.session, run, exec.callId)

      // Bridge the tool's abort signal to the run: if the parent step is aborted while the
      // script is in flight, cancel the whole run. The signal also enters the engine directly, but
      // this local bridge preserves the tool contract even if an implementation ignores it.
      const onAbort = (): void => { run.cancel('parent step aborted') }
      exec.signal.addEventListener('abort', onAbort, { once: true })

      let result: WorkflowResult | undefined
      try {
        result = await run.result
        const error = stopReasonError(result)
        if (error !== undefined) {
          // Map a non-clean finish to an isError result (the registry turns a
          // throw into an isError). Report the reason, not partial output.
          throw new Error(error)
        }
        return {
          runId: run.id,
          agentsStarted: result.agentsStarted,
          result: result.value as JsonValue,
        }
      } finally {
        exec.signal.removeEventListener('abort', onAbort)
        try {
          // Keep member listeners alive through disposal: an engine may
          // synthesize cancelled member endings while reaching quiescence.
          await run.dispose()
          if (recordsRun) {
            // WorkflowRun.result never rejects, so assignment precedes this finally by contract.
            recorder.finish(run.id, (result as WorkflowResult).stopReason)
          }
        } finally {
          if (recordsRun) recorder.abandon(run.id)
        }
      }
    },
    presentCall: args => presentWorkflowCall(args),
    presentResult: (args, result) => presentWorkflowResult(args, result),
  }))
}
