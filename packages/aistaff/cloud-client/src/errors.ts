/** Explicit, Renderer-safe failures from the Host Cloud adapter. */

/** Error categories that callers may map to stable product errors. */
export type CloudClientGatewayErrorCode =
  | 'ABORTED'
  | 'TIMEOUT'
  | 'TRANSPORT'
  | 'PROTOCOL'
  | 'VERSION_MISMATCH'
  | 'EXPIRED'
  | 'UNKNOWN_OUTCOME'
  | 'REMOTE'

/** Host-side adapter error that never carries tokens, raw response bodies, or provider traces. */
export class CloudClientGatewayError extends Error {
  /**
   * @param code - stable local error category.
   * @param message - safe diagnostic without Cloud response text.
   * @param operationId - original mutation id when reconciliation is required.
   */
  constructor(
    readonly code: CloudClientGatewayErrorCode,
    message: string,
    readonly operationId?: string,
  ) {
    super(message)
    this.name = 'CloudClientGatewayError'
  }
}

/** Transport failure with delivery state needed for safe mutation recovery. */
export class ClientGatewayTransportError extends Error {
  /**
   * @param kind - carrier failure category.
   * @param requestDispatched - whether Cloud may have accepted the request.
   */
  constructor(
    readonly kind: 'aborted' | 'timeout' | 'network',
    readonly requestDispatched: boolean,
  ) {
    super(`Client Gateway transport ${kind}`)
    this.name = 'ClientGatewayTransportError'
  }
}
