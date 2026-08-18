/** Production composition seam for the Aistaff Cloud Employee Experience provider. */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@voyaseek-ai/cordis'
import CloudClientGatewayAdapter from '@voyaseek-ai/dsh-aistaff-cloud-client'
import type {
  ClientGatewayContractArtifact,
  ClientGatewayTransport,
} from '@voyaseek-ai/dsh-aistaff-cloud-client'
import type { EmployeeExperienceSnapshot } from '@voyaseek-ai/dsh-aistaff-employee-experience'
import z from '@voyaseek-ai/schemastery'

/** Context key for production-owned artifact, transport, and semantic hello inputs. */
export const AISTAFF_CLIENT_GATEWAY_INPUTS_KEY = 'aistaffClientGatewayInputs' as const

/** Stable setup failure emitted before the Employee Experience service is published. */
export const CLIENT_GATEWAY_UNAVAILABLE = 'CLIENT_GATEWAY_UNAVAILABLE' as const

/** Non-serializable Host inputs supplied by the production artifact and authentication assembly. */
export interface AistaffClientGatewayInputValues {
  /** Exact immutable artifact codec admitted by the application release. */
  readonly artifact: ClientGatewayContractArtifact
  /** Authenticated Host transport that owns origin resolution and credentials. */
  readonly transport: ClientGatewayTransport
  /** Semantic hello encoded only by the admitted artifact. */
  readonly clientHello: unknown
}

/** Single Host service carrying all non-serializable Client Gateway inputs. */
export class AistaffClientGatewayInputs extends Service {
  /** Exact immutable artifact codec admitted by the application release. */
  readonly artifact: ClientGatewayContractArtifact
  /** Authenticated Host transport that owns origin resolution and credentials. */
  readonly transport: ClientGatewayTransport
  /** Semantic hello encoded only by the admitted artifact. */
  readonly clientHello: unknown

  /**
   * @param ctx - Host context that owns these production inputs.
   * @param values - admitted artifact, authenticated transport, and semantic hello.
   */
  constructor(ctx: Context, values: AistaffClientGatewayInputValues) {
    super(ctx, AISTAFF_CLIENT_GATEWAY_INPUTS_KEY)
    this.artifact = values.artifact
    this.transport = values.transport
    this.clientHello = values.clientHello
  }
}

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Production Client Gateway inputs; absent until an owner explicitly supplies them. */
    aistaffClientGatewayInputs?: AistaffClientGatewayInputs
  }
}

/** Deployment tunables for protocol negotiation, transport bounds, and reconnect cadence. */
export interface Config {
  /** Gateway protocol ranges in client preference order. */
  readonly protocolOffer: string
  /** Bounded HTTP request timeout in milliseconds. */
  readonly requestTimeoutMs: number
  /** Maximum resources requested per projection page. */
  readonly pageLimit: number
  /** Time before selection expiry at which the Host renews and rebuilds. */
  readonly selectionRenewalSkewMs: number
  /** Delay after a clean or failed SSE connection before reconnecting. */
  readonly reconnectDelayMs: number
}

/** Strict loader validation for every deployment-varying provider choice. */
export const Config: z<Config> = z.object({
  protocolOffer: z.string().min(1).required(),
  requestTimeoutMs: z.natural().min(1).required(),
  pageLimit: z.natural().min(1).required(),
  selectionRenewalSkewMs: z.natural().required(),
  reconnectDelayMs: z.natural().required(),
})

/** Cordis plugin name. */
export const name = 'aistaff-cloud-provider'

/** No static injection: missing production inputs must fail instead of suspending. */
export const inject: readonly string[] = []

/** Setup failure with a stable code and no transport response or credential detail. */
export class AistaffCloudProviderSetupError extends Error {
  /** Stable setup failure code safe for local diagnostics. */
  readonly code = CLIENT_GATEWAY_UNAVAILABLE

  /** @param reason - stable, safe local reason category. */
  constructor(readonly reason: 'missing_inputs' | 'initial_sync_failed') {
    super(`${CLIENT_GATEWAY_UNAVAILABLE}: ${reason}`)
    this.name = 'AistaffCloudProviderSetupError'
  }
}

function initialSnapshot(): EmployeeExperienceSnapshot {
  return {
    state: 'loading',
    workforce: null,
    engagements: [],
    has_more_engagements: false,
    current_engagement: null,
    view_generation: 0,
  }
}

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || delayMs === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, delayMs)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

async function reconnectLoop(
  ctx: Context,
  adapter: CloudClientGatewayAdapter,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    const result = await adapter.consumeEvents(signal)
    if (signal.aborted) return
    if (!result.ok) ctx.logger.warn(`Aistaff Client Gateway event stream ended: ${result.error.code}`)
    await cancellableDelay(delayMs, signal)
  }
}

/**
 * Synchronize the initial Cloud baseline, publish EmployeeExperiencePort, and
 * own a cancellable SSE reconnect loop for the plugin lifetime.
 * @param ctx - Host plugin context.
 * @param config - explicit deployment tunables.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const inputs = ctx.get(AISTAFF_CLIENT_GATEWAY_INPUTS_KEY)
  if (inputs === undefined) throw new AistaffCloudProviderSetupError('missing_inputs')

  // The adapter's Service base registers immediately. Isolate that temporary
  // registration so the production key cannot become visible before sync.
  const staging = ctx.isolate('employeeExperience')
  const adapter = new CloudClientGatewayAdapter(staging, {
    protocolOffer: config.protocolOffer,
    requestTimeoutMs: config.requestTimeoutMs,
    pageLimit: config.pageLimit,
    selectionRenewalSkewMs: config.selectionRenewalSkewMs,
    clock: () => new Date(),
    createOperationId: randomUUID,
    transport: inputs.transport,
    artifact: inputs.artifact,
    initialSnapshot: initialSnapshot(),
  })
  const synchronized = await adapter.synchronize(inputs.clientHello)
  if (!synchronized.ok) throw new AistaffCloudProviderSetupError('initial_sync_failed')

  ctx.provide('employeeExperience', adapter)
  const lifetime = new AbortController()
  const loop = reconnectLoop(ctx, adapter, config.reconnectDelayMs, lifetime.signal)
  ctx.effect(() => async () => {
    lifetime.abort()
    await loop
  }, 'aistaffCloudProvider.eventStream')
}
