/**
 * Claude Agent SDK driver plugin: registers one alternative loop driver
 * runtime. Sessions whose header records the runtime are driven by the
 * official SDK in the session workspace, using deployment-supplied
 * Claude-API-compatible credentials; every other session keeps the default
 * loop. The SDK dependency pins independently of the harness.
 * @module @voyaseek-ai/dsh-claude-agent
 */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Settings,
} from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import type { AgentDriverFactory } from '@voyaseek-ai/dsh-agent-loop'
import { CallId } from '@voyaseek-ai/dsh-llm'
import { effectiveSandboxMode } from '@voyaseek-ai/dsh-sandbox-policy'
import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import { scrubbedParentEnv } from '@voyaseek-ai/dsh-subprocess'
import { effectiveApprovalPolicy } from '@voyaseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@voyaseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer, AskUserQuestionItem } from '@voyaseek-ai/dsh-user-questions'
import '@voyaseek-ai/dsh-user-questions'
import { CLAUDE_PROVIDER, CLAUDE_RUNTIME } from './constants.ts'
import { ClaudeSdkAgent } from './driver.ts'
import { SdkQueryEngine } from './engine.ts'
import type {} from './types.ts'

export const name = 'claude-agent'
export const inject = ['agentLoop', 'subprocess']

/** Permission postures the plugin admits; `dontAsk` stays out because DSH owns denial policy. */
export type ClaudePermissionMode = Extract<PermissionMode, 'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'plan'>

/** Plugin config. All fields optional; `Config` supplies the defaults. */
export interface Config {
  /** Runtime id matched against session headers; deployments rarely rename it. */
  readonly runtime?: string
  /** Model id pinned for every query; absent keeps the SDK/CLI default. */
  readonly model?: string
  /** Claude-API-compatible endpoint base URL (`ANTHROPIC_BASE_URL`). */
  readonly baseUrl?: string
  /** Bearer token for gateway endpoints (`ANTHROPIC_AUTH_TOKEN`). */
  readonly authToken?: string
  /** API key (`ANTHROPIC_API_KEY`); gateways accept either credential field. */
  readonly apiKey?: string
  /** Explicit SDK permission posture; absent follows the session's DSH permission state. */
  readonly permissionMode?: ClaudePermissionMode
  /** Explicit Claude Code executable; absent uses the SDK-distributed CLI. */
  readonly executable?: string
  /** Extra child environment layered over the credential-scrubbed parent env. */
  readonly env?: Record<string, string>
  /** Process-tree termination grace in milliseconds. */
  readonly disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  runtime: z.string().default(CLAUDE_RUNTIME),
  model: z.string(),
  baseUrl: z.string(),
  authToken: z.string(),
  apiKey: z.string(),
  permissionMode: z.union(['default', 'acceptEdits', 'auto', 'bypassPermissions', 'plan'] as const),
  executable: z.string(),
  env: z.dict(z.string()).default({}),
  disposeGraceMs: z.number().default(3_000),
})

/** Validated config owned by the plugin. */
export interface ResolvedConfig {
  readonly runtime: string
  readonly permissionMode?: ClaudePermissionMode
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly model?: string
  readonly baseUrl?: string
  readonly authToken?: string
  readonly apiKey?: string
  readonly executable?: string
}

/**
 * Compose the complete SDK child environment: the credential-scrubbed parent
 * environment, the deployment's explicit overlay, and the endpoint fields
 * mapped onto the `ANTHROPIC_*` variables the CLI honors. Any
 * Claude-API-compatible gateway therefore works through `baseUrl` plus one
 * credential field.
 * @param config - validated plugin configuration.
 * @returns the exact environment handed to every SDK child.
 */
export function claudeChildEnv(config: ResolvedConfig): Record<string, string> {
  const env: Record<string, string> = { ...scrubbedParentEnv(), ...config.env }
  if (config.baseUrl !== undefined) env['ANTHROPIC_BASE_URL'] = config.baseUrl
  if (config.authToken !== undefined) env['ANTHROPIC_AUTH_TOKEN'] = config.authToken
  if (config.apiKey !== undefined) env['ANTHROPIC_API_KEY'] = config.apiKey
  if (config.model !== undefined) env['ANTHROPIC_MODEL'] = config.model
  return env
}

/**
 * Resolve the Claude SDK permission posture from the latest durable session
 * permission state. An explicit plugin setting wins. Otherwise only DSH's
 * workspace-write with interactive approval uses the SDK's classifier-backed
 * auto review. Full access keeps the SDK default path so AskUserQuestion still
 * reaches the DSH interaction callback; that callback directly allows other
 * tools for the exact full-access/no-prompt pair. Every remaining combination
 * uses the SDK default posture.
 * @param events - current session events in log order.
 * @param configured - optional deployment override.
 * @returns the SDK permission posture for the next query.
 */
export function claudePermissionMode(
  events: readonly SessionEvent[],
  configured?: ClaudePermissionMode,
): ClaudePermissionMode {
  if (configured !== undefined) return configured
  const sandbox = effectiveSandboxMode(events)
  const approval = effectiveApprovalPolicy(events)
  if (sandbox === 'workspace-write' && approval === 'ask') return 'auto'
  return 'default'
}

/**
 * Translate one DSH approval outcome into the Claude SDK permission result.
 * Remembered grants return only SDK-authored session allow-rule additions;
 * every broader settings destination or permission mutation fails closed.
 * @param outcome - normalized DSH approval outcome.
 * @param input - original Claude tool input.
 * @param toolName - exact tool whose permission request produced the suggestions.
 * @param suggestions - SDK-authored permission updates for this request.
 * @returns the SDK permission result.
 */
export function claudePermissionResult(
  outcome: ApprovalOutcome,
  input: Record<string, unknown>,
  toolName: string,
  suggestions: readonly PermissionUpdate[] | undefined,
): PermissionResult {
  if (outcome === 'allowed-once') return { behavior: 'allow', updatedInput: input }
  const rememberable = claudeRememberablePermissionUpdates(toolName, suggestions)
  if (outcome === 'allowed-and-remembered' && rememberable.length > 0) {
    return { behavior: 'allow', updatedInput: input, updatedPermissions: rememberable }
  }
  const message = outcome === 'rejected'
    ? 'The user rejected this operation.'
    : outcome === 'cancelled'
      ? 'The approval request was cancelled.'
      : outcome === 'allowed-and-remembered'
        ? 'Claude supplied no permission rule to remember; the operation was refused.'
        : 'No approval answerer is available; the operation was refused.'
  return { behavior: 'deny', message }
}

type ClaudePermissionSettings = NonNullable<Settings['permissions']>

function permissionRuleText(rule: { toolName: string; ruleContent?: string }): string {
  return rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`
}

function addUnique(target: string[], values: readonly string[]): string[] {
  const result = [...target]
  for (const value of values) {
    if (!result.includes(value)) result.push(value)
  }
  return result
}

/**
 * Retain only the narrow permission update a generic "allow and remember"
 * decision may safely authorize: an SDK-authored allow rule for this Claude
 * session and the same tool. Mixed batches, settings-file writes, mode
 * changes, directory grants, mutations, and deny/ask rules need their own
 * explicit product controls.
 * @param toolName - exact tool whose permission request produced the suggestions.
 * @param suggestions - SDK-authored suggestions for one permission request.
 * @returns safe session allow-rule updates, unchanged and in source order.
 */
export function claudeRememberablePermissionUpdates(
  toolName: string,
  suggestions: readonly PermissionUpdate[] | undefined,
): PermissionUpdate[] {
  if (suggestions === undefined || suggestions.length === 0) return []
  const safe = suggestions.every(update =>
    update.type === 'addRules'
    && update.behavior === 'allow'
    && update.destination === 'session'
    && update.rules.length > 0
    && update.rules.every(rule => rule.toolName === toolName))
  return safe ? [...suggestions] : []
}

/**
 * Fold remembered Claude session allow rules into inline SDK settings. The
 * next SDK child receives them through the highest-priority flag-settings
 * layer, so the grant survives this driver's one-query-per-turn lifecycle.
 * @param current - permission settings remembered by earlier queries.
 * @param toolName - exact tool whose permission request produced the updates.
 * @param updates - SDK-authored suggestions accepted by the user.
 * @returns the settings to apply to the next query.
 */
export function claudeRememberedPermissionSettings(
  current: ClaudePermissionSettings | undefined,
  toolName: string,
  updates: readonly PermissionUpdate[],
): ClaudePermissionSettings | undefined {
  const rememberable = claudeRememberablePermissionUpdates(toolName, updates)
  if (rememberable.length === 0) return current
  let result = current === undefined
    ? undefined
    : {
      ...current,
      ...current.allow === undefined ? {} : { allow: [...current.allow] },
    }
  for (const update of rememberable) {
    result ??= {}
    if (update.type !== 'addRules') continue
    result.allow = addUnique(result.allow ?? [], update.rules.map(permissionRuleText))
  }
  return result
}

interface ClaudeQuestion {
  item: AskUserQuestionItem
  text: string
  multiSelect: boolean
}

function claudeQuestions(input: Record<string, unknown>, toolUseID: string): ClaudeQuestion[] | undefined {
  if (!Array.isArray(input['questions']) || input['questions'].length < 1 || input['questions'].length > 4) return undefined
  const result: ClaudeQuestion[] = []
  const texts = new Set<string>()
  for (const [index, candidate] of input['questions'].entries()) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined
    const question = candidate as Record<string, unknown>
    if (typeof question['question'] !== 'string' || question['question'].length === 0) return undefined
    if (texts.has(question['question'])) return undefined
    texts.add(question['question'])
    if (typeof question['header'] !== 'string' || question['header'].length === 0) return undefined
    if (!Array.isArray(question['options']) || question['options'].length < 2 || question['options'].length > 4) return undefined
    const options = []
    for (const candidateOption of question['options']) {
      if (candidateOption === null || typeof candidateOption !== 'object' || Array.isArray(candidateOption)) return undefined
      const option = candidateOption as Record<string, unknown>
      if (typeof option['label'] !== 'string' || option['label'].length === 0) return undefined
      if (typeof option['description'] !== 'string') return undefined
      options.push({ label: option['label'], description: option['description'] })
    }
    if (typeof question['multiSelect'] !== 'boolean') return undefined
    result.push({
      item: {
        id: `${toolUseID}:${index}`,
        question: question['question'],
        header: question['header'],
        options,
        multiSelect: question['multiSelect'],
      },
      text: question['question'],
      multiSelect: question['multiSelect'],
    })
  }
  return result
}

function claudeQuestionAnswers(
  questions: readonly ClaudeQuestion[],
  answer: AskUserQuestionAnswer,
): Record<string, string> {
  const byId = new Map(answer.answers.map(item => [item.id, item]))
  const result: Record<string, string> = {}
  for (const question of questions) {
    const item = byId.get(question.item.id)
    if (item === undefined) continue
    const parts = question.multiSelect ? [...item.selected] : []
    if (item.custom !== undefined) parts.push(item.custom)
    else if (!question.multiSelect && item.selected[0] !== undefined) parts.push(item.selected[0])
    result[question.text] = parts.join(', ')
  }
  return result
}

/**
 * Build the Claude SDK permission callback for one live driver. Claude's
 * `AskUserQuestion` is a blocking user interaction transported through this
 * callback, not an authorization request, so it delegates to
 * `ctx.userQuestions`; all other tools retain the approval bridge.
 * @param ctx - plugin context carrying optional approval and question services.
 * @param agent - live driver owning the interaction and approval audit.
 * @returns the callback plus the remembered settings resolver for later queries.
 */
export function makeCanUseTool(
  ctx: Context,
  agent: Agent,
): { canUseTool: CanUseTool; permissionSettings: () => ClaudePermissionSettings | undefined } {
  let remembered: ClaudePermissionSettings | undefined
  const canUseTool: CanUseTool = async (toolName, input, sdkOptions) => {
    if (toolName === 'AskUserQuestion') {
      const questions = claudeQuestions(input, sdkOptions.toolUseID)
      if (questions === undefined) {
        return { behavior: 'deny', message: 'Claude supplied an invalid AskUserQuestion request.' }
      }
      const userQuestions = ctx.get('userQuestions')
      if (userQuestions === undefined) {
        return { behavior: 'deny', message: 'No user-questions provider is composed.' }
      }
      try {
        const answer = await userQuestions.ask({
          questions: questions.map(question => question.item),
          agent,
          signal: sdkOptions.signal,
        })
        return {
          behavior: 'allow',
          updatedInput: { ...input, answers: claudeQuestionAnswers(questions, answer) },
        }
      } catch (error: unknown) {
        return {
          behavior: 'deny',
          message: error instanceof Error ? error.message : 'The user question could not be answered.',
        }
      }
    }
    if (effectiveSandboxMode(agent.session.events) === 'danger-full-access'
      && effectiveApprovalPolicy(agent.session.events) === 'never') {
      return { behavior: 'allow', updatedInput: input }
    }
    const approval = ctx.get('approval')
    if (approval === undefined) {
      return {
        behavior: 'deny',
        message: 'No approval service is composed; Claude tool use is refused.',
      }
    }
    const rememberable = claudeRememberablePermissionUpdates(toolName, sdkOptions.suggestions)
    const outcome = await approval.request({
      agent,
      toolName,
      callId: CallId(sdkOptions.toolUseID),
      reason: sdkOptions.title ?? `Claude wants to use the ${toolName} tool`,
      ...rememberable.length > 0
        ? { rememberable: true as const }
        : {},
      signal: sdkOptions.signal,
    })
    if (outcome === 'allowed-and-remembered') {
      remembered = claudeRememberedPermissionSettings(remembered, toolName, rememberable)
    }
    return claudePermissionResult(outcome, input, toolName, sdkOptions.suggestions)
  }
  return { canUseTool, permissionSettings: () => remembered }
}

/**
 * Register the Claude driver factory under the configured runtime id.
 * @param ctx - context carrying the loop and subprocess services.
 * @param config - endpoint credentials, model, permission posture, and process policy.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  if (!Number.isFinite(resolved.disposeGraceMs) || resolved.disposeGraceMs <= 0) {
    throw new Error('claude-agent: disposeGraceMs must be a positive finite number')
  }
  const childEnv = claudeChildEnv(resolved)
  const cwdFallback = process.cwd()
  // Driver scopes root in an injected context so publication can reach the
  // session and agent registries through them, exactly like the default loop.
  let driverCtx: Context | undefined
  ctx.inject(['sessions', 'agents'], (inner) => {
    driverCtx = inner
  })
  const factory: AgentDriverFactory = {
    runtime: resolved.runtime,
    createDriver: ({ id, options, session }) => {
      if (driverCtx === undefined) {
        throw new Error('claude-agent: driver scope context is not ready (sessions/agents inject pending)')
      }
      const cwd = session.header.cwd ?? cwdFallback
      return new ClaudeSdkAgent(
        driverCtx,
        id,
        options,
        session,
        (agent) => {
          const permissionBridge = makeCanUseTool(ctx, agent)
          return new SdkQueryEngine({
            childEnv,
            ...resolved.model === undefined ? {} : { model: resolved.model },
            permissionMode: () => claudePermissionMode(session.events, resolved.permissionMode),
            ...permissionBridge,
            ...resolved.executable === undefined ? {} : { executable: resolved.executable },
            disposeGraceMs: resolved.disposeGraceMs,
            spawn: spawnSpec => ctx.subprocess.spawn(spawnSpec),
          })
        },
        cwd,
        resolved.model ?? CLAUDE_PROVIDER,
      )
    },
  }
  ctx.agentLoop.registerDriverFactory(factory)
}
