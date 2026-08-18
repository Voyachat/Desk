/**
 * Shared wire protocol for the Voyaseek Harness SDK runtime: the
 * newline-delimited JSON-RPC stdio transport plus the named request, result,
 * and notification types both wire ends speak. The runtime server plugin
 * (`@voyaseek-ai/dsh-sdk-jsonrpc-server`) serves this protocol; SDK clients
 * (`@voyaseek-ai/dsh-sdk-client`, the Python SDK) drive it.
 *
 * @module @voyaseek-ai/dsh-sdk-protocol
 */

export { JsonRpcLineTransport, JsonRpcResponseError } from './transport.ts'
export type { JsonRpcTransportPeer } from './transport.ts'
export type {
  HarnessSdkNotificationMap,
  HarnessSdkRequestMap,
  InitializeParams,
  InitializeResult,
  SdkRunStatus,
  SessionEventNotification,
  SessionStatusNotification,
  SessionPromptParams,
  SessionPromptResult,
  SubagentFinishedNotification,
  SubagentStartedNotification,
} from './types.ts'
