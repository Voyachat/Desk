/** Stable user-action class for a failed model request. */
export type FailureDisplayCategory =
  | 'quota'
  | 'rate-limit'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'provider-unavailable'
  | 'context-window'
  | 'invalid-request'
  | 'configuration'
  | 'unknown'

/** Display-safe facts projected from one durable model-request failure. */
export interface FailureDisplay {
  /** Stable category used by localized presentation code. */
  readonly category: FailureDisplayCategory
  /** Bounded diagnostics assembled only from stable structured fields. */
  readonly diagnostic: string
  /** Provider-requested retry delay when it is a valid positive duration. */
  readonly retryAfterMs?: number
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const CATEGORY_BY_CODE = new Map<string, FailureDisplayCategory>([
  ['QUOTA', 'quota'],
  ['QUOTA_EXCEEDED', 'quota'],
  ['RESOURCE_EXHAUSTED', 'quota'],
  ['RATE_LIMIT', 'rate-limit'],
  ['TOO_MANY_REQUESTS', 'rate-limit'],
  ['AUTH', 'auth'],
  ['UNAUTHENTICATED', 'auth'],
  ['UNAUTHORIZED', 'auth'],
  ['FORBIDDEN', 'auth'],
  ['MISSING_CREDENTIAL', 'auth'],
  ['INVALID_CREDENTIAL', 'auth'],
  ['TRANSPORT', 'network'],
  ['NETWORK', 'network'],
  ['NETWORK_ERROR', 'network'],
  ['CONNECTION_ERROR', 'network'],
  ['DNS', 'network'],
  ['TLS', 'network'],
  ['TIMEOUT', 'timeout'],
  ['LLM_STREAM_IDLE_TIMEOUT', 'timeout'],
  ['DEADLINE_EXCEEDED', 'timeout'],
  ['SERVER', 'provider-unavailable'],
  ['SERVICE_UNAVAILABLE', 'provider-unavailable'],
  ['PROVIDER_UNAVAILABLE', 'provider-unavailable'],
  ['STREAM_CLOSED', 'provider-unavailable'],
  ['MALFORMED_RESPONSE', 'provider-unavailable'],
  ['EMPTY_RESPONSE', 'provider-unavailable'],
  ['CONTEXT_WINDOW_EXCEEDED', 'context-window'],
  ['INVALID_REQUEST', 'invalid-request'],
  ['UNSUPPORTED_CONTENT', 'invalid-request'],
  ['NO_ADAPTER', 'configuration'],
  ['UNKNOWN_MODEL', 'configuration'],
  ['UNSUPPORTED_OPTION', 'configuration'],
  ['UNSUPPORTED_REASONING_EFFORT', 'configuration'],
  ['INVALID_MODEL_INFO', 'configuration'],
  ['INVALID_MODEL_CONTEXT', 'configuration'],
  ['INVALID_MODEL_MAX_TOKENS', 'configuration'],
  ['INVALID_MODEL_REASONING', 'configuration'],
  ['INVALID_PREPARED_CALL', 'configuration'],
])

/** Read an own data property without invoking an untrusted accessor. */
function ownValue(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/** Accept only the harness's bounded stable-code spelling. */
function failureCode(failure: unknown): string {
  if (failure === null || typeof failure !== 'object') return 'UNKNOWN'
  const code = ownValue(failure, 'code')
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : 'UNKNOWN'
}

/** Accept one provider HTTP status when present. */
function failureStatus(failure: unknown): number | undefined {
  if (failure === null || typeof failure !== 'object') return undefined
  const status = ownValue(failure, 'status')
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined
}

/** Recover an HTTP status encoded by a stable `HTTP_<status>` code. */
function codedStatus(code: string): number | undefined {
  const match = /^HTTP_([1-5][0-9]{2})$/.exec(code)
  return match === null ? undefined : Number(match[1])
}

/** Accept one provider-requested retry delay when present. */
function failureRetryAfterMs(failure: unknown): number | undefined {
  if (failure === null || typeof failure !== 'object') return undefined
  const delay = ownValue(failure, 'providerRetryAfterMs')
  return typeof delay === 'number' && Number.isFinite(delay) && delay > 0
    ? delay
    : undefined
}

/** Accept only a bounded printable provider request identifier. */
function failureRequestId(failure: unknown): string | undefined {
  if (failure === null || typeof failure !== 'object') return undefined
  const requestId = ownValue(failure, 'requestId')
  return typeof requestId === 'string' && SAFE_REQUEST_ID.test(requestId)
    ? requestId
    : undefined
}

/** Classify by stable code and status; provider message text never participates. */
function categoryOf(code: string, status: number | undefined): FailureDisplayCategory {
  const category = CATEGORY_BY_CODE.get(code)
  if (category !== undefined) return category
  if (/^E(?:CONN|HOST|NET|PIPE|AI_)/.test(code)) return 'network'
  if (status === 401 || status === 403) return 'auth'
  if (status === 402) return 'quota'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429) return 'rate-limit'
  if (status !== undefined && status >= 400 && status < 500) return 'invalid-request'
  if (status !== undefined && status >= 500) return 'provider-unavailable'
  return 'unknown'
}

/**
 * Project a durable model-request failure into safe, localized-UI-ready facts.
 * The provider message is deliberately excluded: bodies and SDK strings may
 * contain credentials, endpoint query parameters, or raw JSON responses.
 * @param failure - Failure value preserved by the session event.
 * @returns Stable category, optional retry delay, and bounded diagnostics.
 */
export function projectFailureDisplay(failure: unknown): FailureDisplay {
  const code = failureCode(failure)
  const status = failureStatus(failure) ?? codedStatus(code)
  const retryAfterMs = failureRetryAfterMs(failure)
  const requestId = failureRequestId(failure)
  const diagnostic = [
    `Code: ${code}`,
    ...status === undefined ? [] : [`HTTP: ${String(status)}`],
    ...retryAfterMs === undefined ? [] : [`Retry-After: ${String(Math.ceil(retryAfterMs))}ms`],
    ...requestId === undefined ? [] : [`Request ID: ${requestId}`],
  ].join(' · ')
  return {
    category: categoryOf(code, status),
    diagnostic,
    ...retryAfterMs === undefined ? {} : { retryAfterMs },
  }
}

/**
 * Convert a durable failure into diagnostic copy that is safe to expose in
 * developer-oriented client views. User-facing surfaces should localize from
 * {@link projectFailureDisplay}'s category instead.
 * @param failure - Failure value preserved by the session event.
 * @returns Display-safe structured diagnostic text.
 */
export function displayFailureMessage(failure: unknown): string {
  return projectFailureDisplay(failure).diagnostic
}
