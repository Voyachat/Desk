/** Host-only Rust Supervisor process transport types. @module @deepseek-ai/dsh-aistaff-supervisor-process/types */

/** JSON value accepted by the authenticated Supervisor wire protocol. */
export type SupervisorJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly SupervisorJsonValue[]
  | SupervisorJsonObject

/** JSON object accepted by the authenticated Supervisor wire protocol. */
export interface SupervisorJsonObject {
  readonly [key: string]: SupervisorJsonValue
}

/** Commands this Host transport is allowed to send to the Rust sidecar. */
export type SupervisorProcessCommand =
  | 'hello'
  | 'health'
  | 'shutdown'
  | 'control.hello'
  | 'control.grant.register'
  | 'control.grant.revoke'
  | 'control.capability.read'
  | 'control.receipt.get'
  | 'control.operation.read'
  | 'capability.file.grant.register'
  | 'capability.file.grant.revoke'
  | 'capability.file.path.admit'
  | 'capability.file.read'
  | 'capability.directory.list'
  | 'capability.file.execution.reconcile'

/** Stable process-transport failure categories safe for Host diagnostics. */
export type SupervisorProcessErrorCode =
  | 'INVALID_CONFIG'
  | 'COMMAND_DENIED'
  | 'SUPERVISOR_START_FAILED'
  | 'SUPERVISOR_UNAVAILABLE'
  | 'REQUEST_TOO_LARGE'
  | 'RESPONSE_TOO_LARGE'
  | 'REQUEST_TIMEOUT'
  | 'PROTOCOL_ERROR'
  | 'REMOTE_ERROR'

/** Authenticated sidecar hello fields validated by this transport. */
export interface RustSupervisorHello {
  /** Rust wire protocol selected for this child process. */
  readonly protocol_version: 'aistaff.desktop-supervisor.v1'
  /** Supervisor crate version. */
  readonly version: string
  /** Host operating-system identifier. */
  readonly platform: string
  /** Host architecture identifier. */
  readonly arch: string
  /** Child process identifier. */
  readonly pid: number
  /** Semantic capabilities advertised by the child. */
  readonly capabilities: readonly string[]
  /** Per-launch authentication mechanism. */
  readonly authentication: 'per_launch_token'
}

/** Sidecar health fields validated by this transport. */
export interface RustSupervisorHealth {
  /** Current child health state. */
  readonly status: 'ok'
  /** Milliseconds since the Rust process started. */
  readonly uptime_ms: number
}

/** Deployment and lifecycle inputs for one Supervisor child process. */
export interface SupervisorProcessOptions {
  /** Absolute path to the packaged Rust binary. */
  readonly binaryPath: string
  /** Absolute private working directory owned by the desktop Host. */
  readonly workingDirectory: string
  /** Maximum time for one wire request before the process is failed closed. */
  readonly requestTimeoutMs: number
  /** Maximum time allowed for authenticated shutdown before forced termination. */
  readonly shutdownTimeoutMs: number
}
