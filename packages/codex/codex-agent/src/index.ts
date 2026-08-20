/** Codex app-server AgentDriver plugin. */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import type { Agent, AgentModelRouteConstraint } from '@voyaseek-ai/dsh-agent'
import { credentialRef } from '@voyaseek-ai/dsh-credentials'
import type { AgentDriverFactory } from '@voyaseek-ai/dsh-agent-loop'
import { CallId } from '@voyaseek-ai/dsh-llm'
import { effectiveSandboxMode } from '@voyaseek-ai/dsh-sandbox-policy'
import { scrubbedParentEnv } from '@voyaseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@voyaseek-ai/dsh-timeout'
import { effectiveApprovalPolicy } from '@voyaseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@voyaseek-ai/dsh-user-approval'
import { CODEX_RUNTIME, DEFAULT_DISPOSE_GRACE_MS } from './constants.ts'
import { CodexAgent, type CodexTurnConfig } from './driver.ts'
import { CodexAppServerEngine } from './engine.ts'
import { codexAppServerArgv } from './process.ts'
import type {} from './types.ts'
import type { CodexServerRequestHandler } from './wire.ts'

export const name = 'codex-agent'
export const inject = ['agentLoop', 'subprocess', 'systemPrompt']

/** Deployment configuration for the Codex runtime. */
export interface Config {
  /** Runtime id matched against session headers. */
  readonly runtime?: string
  /** Codex model-provider id, also used by `agent/request` as its default route. */
  readonly provider?: string
  /** Default Codex model; a per-session AgentOptions model wins when present. */
  readonly model: string
  /** Exact models the configured Responses endpoint admits. */
  readonly models?: string[]
  /** Responses-compatible provider base URL configured for the app-server process. */
  readonly baseUrl?: string
  /** Credential reference resolved immediately before every Codex process starts. */
  readonly apiKeyEnv?: string
  /** Explicit environment layered over the credential-scrubbed parent environment. */
  readonly env?: Record<string, string>
  /** Executable replacing `codex` while retaining `app-server --stdio`. */
  readonly executable?: string
  /** Complete argv override for deployments and deterministic tests. */
  readonly argv?: string[]
  /** Process-tree termination grace in milliseconds. */
  readonly disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  runtime: z.string().default(CODEX_RUNTIME),
  provider: z.string().default('openai'),
  model: z.string(),
  models: z.array(z.string()),
  baseUrl: z.string(),
  apiKeyEnv: z.string(),
  env: z.dict(z.string()).default({}),
  executable: z.string(),
  argv: z.array(z.string()),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
})

interface ResolvedConfig {
  readonly runtime: string
  readonly provider: string
  readonly env: Record<string, string>
  readonly disposeGraceMs: number
  readonly model: string
  readonly models?: string[]
  readonly baseUrl?: string
  readonly apiKeyEnv?: string
  readonly executable?: string
  readonly argv?: string[]
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Build the exact app-server command without placing credentials in argv.
 * @param config - provider protocol fields and process command overrides.
 * @returns the complete app-server argv.
 */
export function configuredCodexArgv(config: Pick<ResolvedConfig, 'provider' | 'baseUrl' | 'apiKeyEnv' | 'executable' | 'argv'>): string[] {
  const argv = config.argv === undefined || config.argv.length === 0 ? undefined : config.argv
  const base = codexAppServerArgv(config.executable, argv)
  if (argv !== undefined || config.baseUrl === undefined) return base
  const provider = config.provider
  const prefix = `model_providers.${provider}`
  const overrides = [
    '-c', `model_provider=${tomlString(provider)}`,
    '-c', `${prefix}.name=${tomlString(provider)}`,
    '-c', `${prefix}.base_url=${tomlString(config.baseUrl)}`,
    '-c', `${prefix}.wire_api="responses"`,
    ...config.apiKeyEnv === undefined ? [] : ['-c', `${prefix}.env_key=${tomlString(config.apiKeyEnv)}`],
  ]
  const subcommand = base.lastIndexOf('app-server')
  if (subcommand < 1) throw new Error('codex-agent: fixed argv omitted the app-server subcommand')
  return [...base.slice(0, subcommand), ...overrides, ...base.slice(subcommand)]
}

/**
 * Resolve child environment and credentials immediately before one turn.
 * @param ctx - context carrying the optional credential provider.
 * @param config - validated process and credential-reference configuration.
 * @param request - optional provider and model selected for this turn.
 * @returns process inputs containing the current credential value only in the child environment.
 */
export async function resolveCodexTurnConfig(
  ctx: Context,
  config: ResolvedConfig,
  request?: { provider: string; model: string },
): Promise<CodexTurnConfig> {
  const route = request === undefined || request.provider === config.provider
    ? undefined
    : ctx.get('llm')?.resolveExternalRuntimeRoute(request.provider, request.model, 'codex')
  if (request !== undefined && request.provider !== config.provider && route === undefined) {
    throw new Error(`codex-agent: provider "${request.provider}" model "${request.model}" has no Responses-compatible runtime route`)
  }
  const turn = route === undefined
    ? config
    : { ...config, provider: route.provider, baseUrl: route.baseURL, apiKeyEnv: route.apiKeyEnv }
  const env: NodeJS.ProcessEnv = { ...scrubbedParentEnv(), ...config.env }
  if (turn.apiKeyEnv !== undefined) {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      throw new Error(`codex-agent: credential ${turn.apiKeyEnv} requires a credentials provider`)
    }
    const resolved = await credentials.resolve(credentialRef(turn.apiKeyEnv))
    if (resolved === undefined) throw new Error(`codex-agent: credential ${turn.apiKeyEnv} is not configured`)
    env[turn.apiKeyEnv] = resolved.value
  }
  return {
    argv: configuredCodexArgv(turn),
    env,
    disposeGraceMs: turn.disposeGraceMs,
  }
}

function admittedRuntimeRoutes(ctx: Context, resolved: ResolvedConfig): AgentModelRouteConstraint[] {
  const routes: AgentModelRouteConstraint[] = [{
    provider: resolved.provider,
    ...resolved.models === undefined || resolved.models.length === 0 ? {} : { models: [...resolved.models] },
  }]
  for (const route of ctx.get('llm')?.listExternalRuntimeRoutes('codex') ?? []) {
    if (route.provider === resolved.provider) continue
    routes.push({ provider: route.provider, models: [...route.models] })
  }
  return routes
}

function availableDecisions(params: Record<string, unknown>): string[] {
  return Array.isArray(params.availableDecisions)
    ? params.availableDecisions.filter((item): item is string => typeof item === 'string')
    : ['accept', 'decline']
}

function codexApprovalDecision(outcome: ApprovalOutcome, available: readonly string[]): string {
  if (outcome === 'allowed-and-remembered' && available.includes('acceptForSession')) return 'acceptForSession'
  if ((outcome === 'allowed-once' || outcome === 'allowed-and-remembered') && available.includes('accept')) return 'accept'
  if (outcome === 'cancelled' && available.includes('cancel')) return 'cancel'
  if (available.includes('decline')) return 'decline'
  if (available.includes('cancel')) return 'cancel'
  throw new Error('codex-agent: app-server offered no fail-closed approval decision')
}

/**
 * Build the DSH approval bridge for Codex command and file-change requests.
 * @param ctx - plugin context carrying the optional approval service.
 * @param agent - live Codex driver whose Session owns policy and audit events.
 * @returns an app-server request handler that permits only DSH-approved operations.
 */
export function makeCodexServerRequest(ctx: Context, agent: Agent): CodexServerRequestHandler {
  return async (method, params, signal) => {
    const available = availableDecisions(params)
    if (effectiveSandboxMode(agent.session.events) === 'danger-full-access'
      && effectiveApprovalPolicy(agent.session.events) === 'never') {
      return { decision: codexApprovalDecision('allowed-once', available) }
    }
    const approval = ctx.get('approval')
    if (approval === undefined) return { decision: codexApprovalDecision('unavailable', available) }
    const rawId = typeof params.itemId === 'string'
      ? params.itemId
      : typeof params.id === 'string' ? params.id : undefined
    if (rawId === undefined || rawId.length === 0) {
      throw new Error('codex-agent: approval request omitted its item id')
    }
    const title = typeof params.reason === 'string'
      ? params.reason
      : typeof params.title === 'string'
        ? params.title
        : method === 'item/fileChange/requestApproval'
          ? 'Codex wants to change files'
          : 'Codex wants to execute a command'
    const outcome = await approval.request({
      agent,
      toolName: method === 'item/fileChange/requestApproval' ? 'CodexFileChange' : 'CodexCommand',
      callId: CallId(rawId),
      reason: title,
      ...available.includes('acceptForSession') ? { rememberable: true as const } : {},
      signal,
    })
    return { decision: codexApprovalDecision(outcome, available) }
  }
}

/** Register the configured Codex runtime beside the default loop. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  if (resolved.runtime.length === 0) throw new Error('codex-agent: runtime must not be empty')
  if (typeof resolved.model !== 'string' || resolved.model.length === 0) {
    throw new Error('codex-agent: model must not be empty')
  }
  if (!/^[A-Za-z0-9_-]+$/.test(resolved.provider)) {
    throw new Error('codex-agent: provider must contain only letters, digits, underscores, or hyphens')
  }
  if (!Number.isFinite(resolved.disposeGraceMs) || resolved.disposeGraceMs <= 0) {
    throw new Error('codex-agent: disposeGraceMs must be a positive finite number')
  }
  if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`codex-agent: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (resolved.apiKeyEnv !== undefined) credentialRef(resolved.apiKeyEnv)
  if (resolved.models !== undefined && resolved.models.length > 0) {
    if (resolved.models.some(model => model.length === 0) || new Set(resolved.models).size !== resolved.models.length) {
      throw new Error('codex-agent: models must contain unique non-empty model ids')
    }
    if (!resolved.models.includes(resolved.model)) {
      throw new Error('codex-agent: models must include the configured default model')
    }
  }
  const argv = configuredCodexArgv(resolved)
  if (argv.length === 0) throw new Error('codex-agent: app-server argv must not be empty')

  const cwdFallback = process.cwd()
  let driverCtx: Context | undefined
  ctx.inject(['sessions', 'agents'], (inner) => { driverCtx = inner })
  const factory: AgentDriverFactory = {
    runtime: resolved.runtime,
    createDriver: ({ id, options, session }) => {
      if (driverCtx === undefined) {
        throw new Error('codex-agent: driver scope context is not ready (sessions/agents inject pending)')
      }
      return new CodexAgent(
        driverCtx,
        id,
        options,
        session,
        resolved.runtime,
        new CodexAppServerEngine(spec => ctx.subprocess.spawn(spec)),
        request => resolveCodexTurnConfig(ctx, resolved, request),
        session.header.cwd ?? cwdFallback,
        resolved.provider,
        resolved.model,
        agent => makeCodexServerRequest(ctx, agent),
        resolved.models === undefined || resolved.models.length === 0 ? undefined : resolved.models,
        admittedRuntimeRoutes(ctx, resolved),
      )
    },
  }
  ctx.agentLoop.registerDriverFactory(factory)
}
