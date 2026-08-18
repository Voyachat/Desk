import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { ReadinessDecoder } from './readiness.js'

/** Inputs required to launch the bundled DSH runtime. */
export interface RuntimeLaunchOptions {
  executable: string
  entry: string
  dshHome: string
  cwd: string
  /** Caller-supplied model credentials passed only through the DSH child environment. */
  readonly credentialEnvironment?: Readonly<NodeJS.ProcessEnv>
  /** Validated HTTP(S) proxy environment for provider network requests. */
  readonly networkEnvironment?: Readonly<NodeJS.ProcessEnv>
  readinessTimeoutMs?: number
  shutdownTimeoutMs?: number
  onLog?: (message: string) => void
  onUnexpectedExit?: (message: string) => void
}

/** Child layout produced by the fixed ignored-stdin, piped-output launch. */
export type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>

/** Minimal spawn signature injected by lifecycle tests. */
export type RuntimeSpawn = (
  executable: string,
  args: string[],
  options: { cwd: string, env: NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'] },
) => RuntimeChild

const DEFAULT_READINESS_TIMEOUT_MS = 30_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000

/** Own one bundled DSH child from spawn through awaited termination. */
export class ManagedRuntime {
  readonly #options: RuntimeLaunchOptions
  readonly #spawn: RuntimeSpawn
  #child: RuntimeChild | undefined
  #termination: Promise<void> | undefined
  #stopping = false
  #terminated = false

  constructor(
    options: RuntimeLaunchOptions,
    spawnRuntime: RuntimeSpawn = (executable, args, spawnOptions) => spawn(executable, args, spawnOptions),
  ) {
    this.#options = options
    this.#spawn = spawnRuntime
  }

  /** Launch the runtime and resolve only after an exact loopback readiness line. */
  start(): Promise<URL> {
    if (this.#child !== undefined) throw new Error('DSH runtime has already been started')
    const child = this.#spawn(this.#options.executable, [
      '--expose-internals',
      this.#options.entry,
      '--profile',
      'aistaff',
      '--port',
      '0',
    ], {
      cwd: this.#options.cwd,
      env: {
        ...this.#options.credentialEnvironment,
        // An explicitly inherited launch credential wins over the desktop's
        // local default, matching the shared credentials provider precedence.
        ...process.env,
        ...this.#options.networkEnvironment,
        VOYASEEK_HOME: this.#options.dshHome,
        DSH_CWD: this.#options.cwd,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.#child = child

    let resolveTermination!: () => void
    this.#termination = new Promise<void>((resolve) => {
      resolveTermination = resolve
    })

    return new Promise<URL>((resolve, reject) => {
      const decoder = new ReadinessDecoder()
      let ready = false
      let settled = false
      const timeout = setTimeout(() => {
        fail(new Error('Timed out waiting for DSH runtime readiness'))
      }, this.#options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS)
      timeout.unref()

      const succeed = (url: URL): void => {
        if (settled) return
        settled = true
        ready = true
        clearTimeout(timeout)
        resolve(url)
      }
      const fail = (error: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.kill('SIGTERM')
        reject(error)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (ready) return
        try {
          const url = decoder.push(chunk)
          if (url !== undefined) succeed(url)
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        this.#options.onLog?.(chunk.toString('utf8'))
      })
      child.once('error', (error) => {
        this.#terminated = true
        resolveTermination()
        if (!ready) fail(error)
        else if (!this.#stopping) this.#options.onUnexpectedExit?.(`DSH runtime failed: ${error.message}`)
      })
      child.once('exit', (code, signal) => {
        this.#terminated = true
        resolveTermination()
        const message = `DSH runtime exited (code=${String(code)}, signal=${String(signal)})`
        if (!ready) fail(new Error(message))
        else if (!this.#stopping) this.#options.onUnexpectedExit?.(message)
      })
    })
  }

  /** Terminate the runtime and await exit, escalating after a bounded grace period. */
  async stop(): Promise<void> {
    const child = this.#child
    const termination = this.#termination
    if (child === undefined || termination === undefined || this.#terminated) return
    this.#stopping = true
    child.kill('SIGTERM')
    if (await settlesWithin(termination, this.#options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS)) return
    child.kill('SIGKILL')
    await termination
  }
}

async function settlesWithin(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs)
    timeout.unref()
  })
  const result = await Promise.race([promise.then(() => true), timedOut])
  if (timeout !== undefined) clearTimeout(timeout)
  return result
}
