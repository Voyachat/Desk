/** Test-only Client Gateway conformance artifact, transport, and input provider. */

import type { Context } from '@deepseek-ai/cordis'
import { AistaffClientGatewayInputs } from '@deepseek-ai/dsh-aistaff-cloud-provider'
import {
  CONFORMANCE_CLIENT_GATEWAY_ARTIFACT,
} from './artifact.ts'
import {
  AistaffCloudConformanceControl,
  InMemoryConformanceClientGateway,
} from './gateway.ts'
import type { ConformanceScenario } from './types.ts'

export * from './artifact.ts'
export * from './gateway.ts'
export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'aistaff-cloud-conformance'

/** No production dependency is required or consumed. */
export const inject: readonly string[] = []

/** Explicit test-only fixture configuration. */
export interface Config {
  /** Business scenario; omitted preserves the V1 approval flow. */
  readonly scenario?: ConformanceScenario
}

/**
 * Provide fixed test-only Client Gateway inputs and deterministic controls.
 * @param ctx - isolated test Host context.
 * @param config - explicit fixture scenario.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const gateway = new InMemoryConformanceClientGateway({ scenario: config.scenario ?? 'approval' })
  new AistaffCloudConformanceControl(ctx, gateway)
  new AistaffClientGatewayInputs(ctx, {
    artifact: CONFORMANCE_CLIENT_GATEWAY_ARTIFACT,
    transport: gateway,
    clientHello: { client_mode: 'none' },
  })
}
