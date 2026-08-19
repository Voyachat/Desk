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
import type { CanUseTool, PermissionMode, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentDriverFactory } from '@voyaseek-ai/dsh-agent-loop'
import { CallId } from '@voyaseek-ai/dsh-llm'
import { effectiveSandboxMode } from '@voyaseek-ai/dsh-sandbox-policy'
import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import { scrubbedParentEnv } from '@voyaseek-ai/dsh-subprocess'
import { effectiveApprovalPolicy } from '@voyaseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@voyaseek-ai/dsh-user-approval'
import { CLAUDE_PROVIDER, CLAUDE_RUNTIME } from './constants.ts'
import { ClaudeSdkAgent } from './driver.ts'
import { SdkQueryEngine } from './engine.ts'
import type {} from './types.ts'

export const name = 'claude-agent'
export const inject = ['agentLoop', 'subprocess']

/** Permission postures the plugin admits; the SDK's interactive modes stay out. */
export type ClaudePermissionMode = Extract<PermissionMode, 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'>

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
  permissionMode: z.union(['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const),
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
 * full-access, no-prompt combination bypasses the SDK permission checks;
 * workspace-write with interactive approval accepts file edits while keeping
 * the approval bridge for other SDK permission requests; every remaining
 * combination uses the SDK default posture.
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
  if (sandbox === 'danger-full-access' && approval === 'never') return 'bypassPermissions'
  if (sandbox === 'workspace-write' && approval === 'ask') return 'acceptEdits'
  return 'default'
}

/**
 * Translate one DSH approval outcome into the Claude SDK permission result.
 * Remembered grants return the SDK's complete suggestion set unchanged; the
 * host never broadens or reconstructs Claude's permission rules.
 * @param outcome - normalized DSH approval outcome.
 * @param input - original Claude tool input.
 * @param suggestions - SDK-authored permission updates for this request.
 * @returns the SDK permission result.
 */
export function claudePermissionResult(
  outcome: ApprovalOutcome,
  input: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[] | undefined,
): PermissionResult {
  if (outcome === 'allowed-once') return { behavior: 'allow', updatedInput: input }
  if (outcome === 'allowed-and-remembered' && suggestions !== undefined && suggestions.length > 0) {
    return { behavior: 'allow', updatedInput: input, updatedPermissions: [...suggestions] }
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

/**
 * Bridge SDK permission questions onto the DSH approval seam. The answer is
 * one DSH approval outcome translated verbatim; a missing approval service
 * fails closed exactly like the default tool pipeline.
 * @param ctx - plugin context reading the optional approval service.
 * @param agent - driver the questions belong to.
 * @returns the SDK permission callback.
 */
function makeCanUseTool(ctx: Context, agent: ClaudeSdkAgent): CanUseTool {
  return async (toolName, input, sdkOptions) => {
    const approval = ctx.get('approval')
    if (approval === undefined) {
      return {
        behavior: 'deny',
        message: 'No approval service is composed; Claude tool use is refused.',
      }
    }
    const outcome = await approval.request({
      agent,
      toolName,
      callId: CallId(sdkOptions.toolUseID),
      reason: sdkOptions.title ?? `Claude wants to use the ${toolName} tool`,
      ...sdkOptions.suggestions !== undefined && sdkOptions.suggestions.length > 0
        ? { rememberable: true as const }
        : {},
      signal: sdkOptions.signal,
    })
    return claudePermissionResult(outcome, input, sdkOptions.suggestions)
  }
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
        agent => new SdkQueryEngine({
          childEnv,
          ...resolved.model === undefined ? {} : { model: resolved.model },
          permissionMode: () => claudePermissionMode(session.events, resolved.permissionMode),
          canUseTool: makeCanUseTool(ctx, agent),
          ...resolved.executable === undefined ? {} : { executable: resolved.executable },
          disposeGraceMs: resolved.disposeGraceMs,
          spawn: spawnSpec => ctx.subprocess.spawn(spawnSpec),
        }),
        cwd,
        resolved.model ?? CLAUDE_PROVIDER,
      )
    },
  }
  ctx.agentLoop.registerDriverFactory(factory)
}
