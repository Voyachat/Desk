/** Authenticated JSONL transport for the Rust Supervisor sidecar. */

import { randomBytes, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { TextDecoder } from 'node:util'
import type {
  RustSupervisorHealth,
  RustSupervisorHello,
  SupervisorJsonObject,
  SupervisorJsonValue,
  SupervisorProcessCommand,
  SupervisorProcessErrorCode,
  SupervisorProcessOptions,
} from './types.ts'

const WIRE_PROTOCOL_VERSION = 'aistaff.desktop-supervisor.v1'
const MAX_LINE_BYTES = 64 * 1024
const MAX_REQUEST_TIMEOUT_MS = 60_000
const MAX_SHUTDOWN_TIMEOUT_MS = 10_000
const SAFE_ERROR_MESSAGES: Readonly<Record<SupervisorProcessErrorCode, string>> = {
  INVALID_CONFIG: 'Supervisor process configuration is invalid.',
  COMMAND_DENIED: 'Supervisor command is not allowed by this Host transport.',
  SUPERVISOR_START_FAILED: 'Supervisor process could not be started.',
  SUPERVISOR_UNAVAILABLE: 'Supervisor process is unavailable.',
  REQUEST_TOO_LARGE: 'Supervisor request exceeds the wire limit.',
  RESPONSE_TOO_LARGE: 'Supervisor response exceeds the wire limit.',
  REQUEST_TIMEOUT: 'Supervisor request timed out with an unknown outcome.',
  PROTOCOL_ERROR: 'Supervisor returned an invalid protocol response.',
  REMOTE_ERROR: 'Supervisor rejected the request.',
}

const ALLOWED_COMMANDS: ReadonlySet<string> = new Set<SupervisorProcessCommand>([
  'hello',
  'health',
  'shutdown',
  'control.hello',
  'control.grant.register',
  'control.grant.revoke',
  'control.capability.read',
  'control.receipt.get',
  'control.operation.read',
  'capability.file.grant.register',
  'capability.file.grant.revoke',
  'capability.file.path.admit',
  'capability.file.read',
  'capability.directory.list',
  'capability.file.execution.reconcile',
])

interface PendingRequest {
  readonly resolve: (result: SupervisorJsonObject) => void
  readonly reject: (error: SupervisorProcessError) => void
  readonly timer: NodeJS.Timeout
}

/** Path-free structured failure from the sidecar process transport. */
export class SupervisorProcessError extends Error {
  /** Stable Host transport failure category. */
  readonly code: SupervisorProcessErrorCode
  /** Stable Rust error code when the authenticated peer rejected a request. */
  readonly remote_code?: string

  /**
   * Create a failure containing no child environment, payload, path, or stderr.
   * @param code - stable Host transport failure category.
   * @param remoteCode - optional bounded Rust error code.
   */
  constructor(code: SupervisorProcessErrorCode, remoteCode?: string) {
    super(SAFE_ERROR_MESSAGES[code])
    this.name = 'SupervisorProcessError'
    this.code = code
    if (remoteCode !== undefined) this.remote_code = remoteCode
  }
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function isJsonValue(value: unknown): value is SupervisorJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return typeof value === 'object' && Object.values(value).every(isJsonValue)
}

function isJsonObject(value: unknown): value is SupervisorJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value)
}

function safeRemoteCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : undefined
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const name of [
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'PATHEXT',
  ]) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function validateOptions(options: SupervisorProcessOptions): void {
  if (
    !isAbsolute(options.binaryPath) ||
    !isAbsolute(options.workingDirectory) ||
    !Number.isSafeInteger(options.requestTimeoutMs) ||
    options.requestTimeoutMs < 1 ||
    options.requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS ||
    !Number.isSafeInteger(options.shutdownTimeoutMs) ||
    options.shutdownTimeoutMs < 1 ||
    options.shutdownTimeoutMs > MAX_SHUTDOWN_TIMEOUT_MS
  ) {
    throw new SupervisorProcessError('INVALID_CONFIG')
  }
}

/** Owns one authenticated Rust Supervisor child and its in-flight requests. */
export class SupervisorProcessController {
  readonly #options: SupervisorProcessOptions
  readonly #pending = new Map<string, PendingRequest>()
  readonly #decoder = new TextDecoder('utf-8', { fatal: true })
  #child: ChildProcessWithoutNullStreams | undefined
  #token: string | undefined
  #buffer = Buffer.alloc(0)
  #hello: RustSupervisorHello | undefined
  #exitPromise: Promise<void> = Promise.resolve()
  #settleExit: (() => void) | undefined
  #started = false
  #stopping = false

  /** @param options - absolute binary/runtime paths and bounded lifecycle timeouts. */
  constructor(options: SupervisorProcessOptions) {
    validateOptions(options)
    this.#options = options
  }

  /**
   * Spawn the sidecar and complete the authenticated hello before returning.
   * @returns validated Rust Supervisor process facts.
   */
  async start(): Promise<RustSupervisorHello> {
    if (this.#hello !== undefined) return this.#hello
    if (this.#started) throw new SupervisorProcessError('SUPERVISOR_UNAVAILABLE')
    this.#started = true
    const token = randomBytes(32).toString('base64url')
    this.#token = token
    const child = spawn(this.#options.binaryPath, [], {
      cwd: this.#options.workingDirectory,
      env: childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    child.stderr.on('data', () => {
      // Child diagnostics can contain private local details and are intentionally discarded.
    })
    child.stdout.on('data', (chunk: Buffer) => this.#acceptOutput(chunk))
    child.stdout.on('end', () => this.#handleEof())
    this.#exitPromise = new Promise((resolve) => {
      this.#settleExit = resolve
    })
    child.once('close', () => this.#handleExit())
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', () => reject(new SupervisorProcessError('SUPERVISOR_START_FAILED')))
    }).catch((error: unknown) => {
      this.#failAll(error instanceof SupervisorProcessError ? error : new SupervisorProcessError('SUPERVISOR_START_FAILED'))
      throw error
    })

    try {
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(`${token}\n`, (error) => {
          if (error === null || error === undefined) resolve()
          else reject(new SupervisorProcessError('SUPERVISOR_START_FAILED'))
        })
      })
      const result = await this.#request('hello', undefined, this.#options.requestTimeoutMs)
      this.#hello = validateHello(result)
      return this.#hello
    } catch (error) {
      child.kill()
      await this.join()
      throw error
    }
  }

  /**
   * Read the authenticated hello retained for the current child process.
   * @returns the validated hello from the current child process.
   */
  hello(): RustSupervisorHello {
    if (this.#hello === undefined) throw new SupervisorProcessError('SUPERVISOR_UNAVAILABLE')
    return this.#hello
  }

  /**
   * Request fresh liveness fields from the authenticated child.
   * @returns current validated Supervisor liveness fields.
   */
  async health(): Promise<RustSupervisorHealth> {
    return validateHealth(await this.invoke('health'))
  }

  /**
   * Send one allowlisted authenticated command.
   * @param command - exact Rust command admitted by this package.
   * @param payload - optional internal Rust wire object.
   * @returns a bounded JSON object from the authenticated child.
   */
  invoke(command: SupervisorProcessCommand, payload?: SupervisorJsonObject): Promise<SupervisorJsonObject> {
    if (!ALLOWED_COMMANDS.has(command)) return Promise.reject(new SupervisorProcessError('COMMAND_DENIED'))
    return this.#request(command, payload, this.#options.requestTimeoutMs)
  }

  /** Authenticate shutdown, force termination after the configured bound, and join the child. */
  async stop(): Promise<void> {
    const child = this.#child
    if (child === undefined || child.exitCode !== null || this.#stopping) return this.join()
    this.#stopping = true
    try {
      await this.#request('shutdown', undefined, this.#options.shutdownTimeoutMs)
    } catch {
      // The structured caller-visible failure is preserved by request(); shutdown still must finish.
    }
    const exited = await Promise.race([
      this.join().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), this.#options.shutdownTimeoutMs)),
    ])
    if (!exited) child.kill()
    await this.join()
  }

  /**
   * Wait for the owned process lifecycle to settle without terminating it.
   * @returns when the owned child and all pending requests have settled.
   */
  join(): Promise<void> {
    return this.#exitPromise
  }

  #request(
    command: SupervisorProcessCommand,
    payload: SupervisorJsonObject | undefined,
    timeoutMs: number,
  ): Promise<SupervisorJsonObject> {
    const child = this.#child
    const token = this.#token
    if (child === undefined || token === undefined || child.exitCode !== null || this.#stopping && command !== 'shutdown') {
      return Promise.reject(new SupervisorProcessError('SUPERVISOR_UNAVAILABLE'))
    }
    if (!ALLOWED_COMMANDS.has(command)) return Promise.reject(new SupervisorProcessError('COMMAND_DENIED'))
    const requestId = randomUUID()
    const frame: Record<string, SupervisorJsonValue> = {
      protocol_version: WIRE_PROTOCOL_VERSION,
      request_id: requestId,
      auth_token: token,
      command,
    }
    if (payload !== undefined) frame.payload = payload
    const encoded = Buffer.from(`${JSON.stringify(frame)}\n`, 'utf8')
    if (encoded.byteLength > MAX_LINE_BYTES) {
      return Promise.reject(new SupervisorProcessError('REQUEST_TOO_LARGE'))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new SupervisorProcessError('REQUEST_TIMEOUT')
        this.#failAll(error)
        child.kill()
      }, timeoutMs)
      this.#pending.set(requestId, { resolve, reject, timer })
      child.stdin.write(encoded, (error) => {
        if (error === null || error === undefined) return
        this.#failAll(new SupervisorProcessError('SUPERVISOR_UNAVAILABLE'))
        child.kill()
      })
    })
  }

  #acceptOutput(chunk: Buffer): void {
    let remaining = chunk
    while (remaining.byteLength !== 0) {
      const newline = remaining.indexOf(0x0a)
      if (newline < 0) {
        if (this.#buffer.byteLength + remaining.byteLength > MAX_LINE_BYTES) {
          this.#protocolFailure('RESPONSE_TOO_LARGE')
          return
        }
        this.#buffer = Buffer.concat([this.#buffer, remaining])
        return
      }
      const segment = remaining.subarray(0, newline)
      remaining = remaining.subarray(newline + 1)
      if (this.#buffer.byteLength + segment.byteLength > MAX_LINE_BYTES) {
        this.#protocolFailure('RESPONSE_TOO_LARGE')
        return
      }
      const line = this.#buffer.byteLength === 0 ? segment : Buffer.concat([this.#buffer, segment])
      this.#buffer = Buffer.alloc(0)
      this.#acceptLine(line.at(-1) === 0x0d ? line.subarray(0, -1) : line)
      if (this.#child === undefined) return
    }
  }

  #acceptLine(line: Buffer): void {
    let value: unknown
    try {
      value = JSON.parse(this.#decoder.decode(line))
    } catch {
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    const expectedPayloadKey = (value as Record<string, unknown>).ok === true ? 'result' : 'error'
    if (!exactObject(value, ['protocol_version', 'request_id', 'ok', expectedPayloadKey])) {
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    if (value.protocol_version !== WIRE_PROTOCOL_VERSION || typeof value.request_id !== 'string' || typeof value.ok !== 'boolean') {
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    const pending = this.#pending.get(value.request_id)
    if (pending === undefined) {
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    this.#pending.delete(value.request_id)
    clearTimeout(pending.timer)
    if (value.ok) {
      if (!isJsonObject(value.result)) {
        pending.reject(new SupervisorProcessError('PROTOCOL_ERROR'))
        this.#protocolFailure('PROTOCOL_ERROR')
        return
      }
      pending.resolve(value.result)
      return
    }
    if (!exactObject(value.error, ['code'])) {
      pending.reject(new SupervisorProcessError('PROTOCOL_ERROR'))
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    const remoteCode = safeRemoteCode(value.error.code)
    if (remoteCode === undefined) {
      pending.reject(new SupervisorProcessError('PROTOCOL_ERROR'))
      this.#protocolFailure('PROTOCOL_ERROR')
      return
    }
    pending.reject(new SupervisorProcessError('REMOTE_ERROR', remoteCode))
  }

  #handleEof(): void {
    if (this.#buffer.byteLength !== 0 && !this.#stopping) this.#protocolFailure('PROTOCOL_ERROR')
  }

  #handleExit(): void {
    this.#token = undefined
    this.#child = undefined
    this.#hello = undefined
    this.#buffer = Buffer.alloc(0)
    if (this.#pending.size !== 0) this.#failAll(new SupervisorProcessError('SUPERVISOR_UNAVAILABLE'))
    this.#settleExit?.()
    this.#settleExit = undefined
  }

  #protocolFailure(code: 'PROTOCOL_ERROR' | 'RESPONSE_TOO_LARGE'): void {
    const child = this.#child
    this.#failAll(new SupervisorProcessError(code))
    child?.kill()
  }

  #failAll(error: SupervisorProcessError): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function validateHello(value: SupervisorJsonObject): RustSupervisorHello {
  if (
    !exactObject(value, ['protocol_version', 'version', 'platform', 'arch', 'pid', 'capabilities', 'authentication']) ||
    value.protocol_version !== WIRE_PROTOCOL_VERSION ||
    typeof value.version !== 'string' ||
    typeof value.platform !== 'string' ||
    typeof value.arch !== 'string' ||
    !Number.isSafeInteger(value.pid) ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((item) => typeof item === 'string') ||
    value.authentication !== 'per_launch_token'
  ) {
    throw new SupervisorProcessError('PROTOCOL_ERROR')
  }
  return value as unknown as RustSupervisorHello
}

function validateHealth(value: SupervisorJsonObject): RustSupervisorHealth {
  if (
    !exactObject(value, ['status', 'uptime_ms']) ||
    value.status !== 'ok' ||
    !Number.isSafeInteger(value.uptime_ms) ||
    (value.uptime_ms as number) < 0
  ) {
    throw new SupervisorProcessError('PROTOCOL_ERROR')
  }
  return value as unknown as RustSupervisorHealth
}
