/**
 * Provider-neutral cross-session agent memory capability.
 *
 * @module @voyaseek-ai/dsh-agent-memory
 */

import { Context, Service } from '@voyaseek-ai/cordis'
import type { Branded } from '@voyaseek-ai/dsh-brand'
import type { SessionId } from '@voyaseek-ai/dsh-session'

/** Stable identifier of one stored memory. */
export type MemoryId = Branded<'MemoryId'>

/** Brand a provider-issued stored-memory identifier. */
export function MemoryId(value: string): MemoryId {
  return value as MemoryId
}

/** Durable memory classes visible to users and the model. */
export type MemoryKind = 'preference' | 'fact' | 'constraint' | 'event'

/** One structured, user-manageable memory item. */
export interface MemoryItem {
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly key: string
  readonly title: string
  readonly content: string
  readonly keywords: readonly string[]
  readonly confidence: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt?: number
  readonly workspace?: string
  readonly source: {
    readonly sessionId: SessionId
    readonly turn: number
    readonly mode: 'automatic' | 'explicit'
  }
}

/** Provider settings and durable maintenance state. */
export interface AgentMemoryStatus {
  readonly enabled: boolean
  readonly autoCapture: boolean
  readonly autoRecall: boolean
  readonly count: number
  readonly pendingCount: number
  readonly failedCount: number
  readonly maxEntries: number
  readonly maxHits: number
}

/** One completed turn queued under a deterministic capture identity. */
export interface CaptureMemoryRequest {
  readonly sessionId: SessionId
  readonly turn: number
  readonly workspace?: string
  readonly userText: string
  readonly assistantText: string
  readonly provider?: string
  readonly model?: string
}

/** Search input derived from the current trusted session. */
export interface RecallMemoryRequest {
  readonly query: string
  readonly workspace?: string
  readonly excludeSessionId?: SessionId
  readonly limit?: number
}

/** Explicit user/model-authored durable fact after tool argument validation. */
export interface RememberMemoryRequest {
  readonly sessionId: SessionId
  readonly turn: number
  readonly workspace?: string
  readonly kind: Exclude<MemoryKind, 'event'>
  readonly key: string
  readonly title: string
  readonly content: string
  readonly keywords?: readonly string[]
}

/** Candidate-aware mutation proposed by an automatic memory maintainer. */
export type MemoryMutation =
  | {
      readonly action: 'upsert'
      readonly kind: MemoryKind
      readonly key: string
      readonly title: string
      readonly content: string
      readonly keywords: readonly string[]
      readonly confidence: number
    }
  | { readonly action: 'delete'; readonly id: MemoryId }
  | { readonly action: 'none' }

/** Input to the automatic extraction and consolidation callback. */
export interface MemoryMaintenanceInput {
  readonly capture: CaptureMemoryRequest
  readonly candidates: readonly MemoryItem[]
}

/** Automatic extractor supplied by the Consumer and run against durable pending captures. */
export type MemoryMaintainer = (
  input: MemoryMaintenanceInput,
  options?: MemoryOperationOptions,
) => Promise<readonly MemoryMutation[]>

/** Result of one bounded pending-capture maintenance pass. */
export interface MemoryMaintenanceResult {
  readonly processed: number
  readonly failed: number
  readonly pending: number
}

/** Cancellation carried beside one provider operation. */
export interface MemoryOperationOptions {
  readonly signal?: AbortSignal
}

declare module '@voyaseek-ai/cordis' {
  interface Context {
    agentMemory: AgentMemory
  }
}

/** Provider-neutral service consumed by context, tool, and management plugins. */
export abstract class AgentMemory extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentMemory')
  }

  /** Read current configuration, item count, and pending maintenance state. */
  abstract status(): AgentMemoryStatus

  /** Durably queue one completed turn after provider-owned secret filtering. */
  abstract capture(
    request: CaptureMemoryRequest,
    options?: MemoryOperationOptions,
  ): Promise<'queued' | 'duplicate' | 'disabled' | 'filtered'>

  /** Process durable pending captures through the supplied automatic maintainer. */
  abstract maintain(
    maintainer: MemoryMaintainer,
    options?: MemoryOperationOptions,
  ): Promise<MemoryMaintenanceResult>

  /** Store or replace one explicit structured memory. */
  abstract remember(request: RememberMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem>

  /** Recall relevant, unexpired items in provider-defined rank order. */
  abstract recall(request: RecallMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem[]>

  /** List stored items newest first for a local management surface. */
  abstract list(options?: MemoryOperationOptions): Promise<MemoryItem[]>

  /** Delete explicitly identified items. */
  abstract forget(ids: readonly MemoryId[], options?: MemoryOperationOptions): Promise<number>

  /** Delete every stored item and pending capture while retaining configuration. */
  abstract clear(options?: MemoryOperationOptions): Promise<number>
}

export default AgentMemory
