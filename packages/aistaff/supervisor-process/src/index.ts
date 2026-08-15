/** Host-only authenticated process provider for the Rust Supervisor sidecar. @module @deepseek-ai/dsh-aistaff-supervisor-process */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SupervisorProcessController } from './process.ts'
import type {
  RustSupervisorHealth,
  RustSupervisorHello,
  SupervisorJsonObject,
  SupervisorProcessCommand,
  SupervisorProcessOptions,
} from './types.ts'

export { SupervisorProcessController, SupervisorProcessError } from './process.ts'
export type * from './types.ts'

/** Cordis service key for the authenticated Host sidecar process. */
export const SUPERVISOR_PROCESS_SERVICE_KEY = 'aistaffSupervisorProcess' as const

/** Deployment inputs for one packaged Rust sidecar. */
export interface Config extends SupervisorProcessOptions {}

/** Strict validation for binary/runtime paths and bounded lifecycle timeouts. */
export const Config: z<Config> = z.object({
  binaryPath: z.string().min(1).required(),
  workingDirectory: z.string().min(1).required(),
  requestTimeoutMs: z.natural().min(1).max(60_000).required(),
  shutdownTimeoutMs: z.natural().min(1).max(10_000).required(),
})

/** Cordis plugin name. */
export const name = 'aistaff-supervisor-process'

/** This Host process provider has no service prerequisites. */
export const inject: readonly string[] = []

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Authenticated Host-only Rust sidecar process. */
    aistaffSupervisorProcess: SupervisorProcessService
  }
}

/** Cordis facade over one already-started Supervisor process controller. */
export class SupervisorProcessService extends Service {
  private readonly controller: SupervisorProcessController

  /**
   * Publish one started process controller.
   * @param ctx - Host context owning the child lifecycle.
   * @param controller - controller whose authenticated hello already succeeded.
   */
  constructor(ctx: Context, controller: SupervisorProcessController) {
    super(ctx, SUPERVISOR_PROCESS_SERVICE_KEY)
    this.controller = controller
  }

  /**
   * Read the authenticated hello retained at service publication.
   * @returns the validated authenticated startup hello.
   */
  hello(): RustSupervisorHello {
    return this.controller.hello()
  }

  /**
   * Request fresh liveness fields from the authenticated sidecar.
   * @returns current validated sidecar health.
   */
  health(): Promise<RustSupervisorHealth> {
    return this.controller.health()
  }

  /**
   * Invoke one allowlisted Rust wire operation.
   * @param command - exact command admitted by this package.
   * @param payload - internal Rust wire payload.
   * @returns bounded authenticated Rust result.
   */
  invoke(command: SupervisorProcessCommand, payload?: SupervisorJsonObject): Promise<SupervisorJsonObject> {
    return this.controller.invoke(command, payload)
  }

  /** Authenticate shutdown, force termination after the configured bound, and join. */
  stop(): Promise<void> {
    return this.controller.stop()
  }

  /**
   * Wait for the service-owned process lifecycle to settle without terminating it.
   * @returns when the owned child and all requests have settled.
   */
  join(): Promise<void> {
    return this.controller.join()
  }
}

/**
 * Start and authenticate the packaged sidecar before publishing its Host service.
 * @param ctx - Host plugin context.
 * @param config - absolute binary/runtime paths and lifecycle timeouts.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = new SupervisorProcessController(config)
  await controller.start()
  try {
    const service = new SupervisorProcessService(ctx, controller)
    ctx.effect(() => async () => {
      await service.stop()
      await service.join()
    }, 'aistaffSupervisorProcess.lifecycle')
  } catch (error) {
    await controller.stop()
    await controller.join()
    throw error
  }
}
