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

/**
 * Brand a provider-issued stored-memory identifier.
 * @param value - opaque validated identifier.
 * @returns branded memory identifier.
 */
export function MemoryId(value: string): MemoryId {
  return value as MemoryId
}

/** Stable provider-issued identity for one committed maintenance receipt. */
export type MemoryMaintenanceReceiptId = Branded<'MemoryMaintenanceReceiptId'>

/**
 * Brand a provider-issued maintenance receipt identity.
 * @param value - opaque validated identifier.
 * @returns branded maintenance receipt identity.
 */
export function MemoryMaintenanceReceiptId(value: string): MemoryMaintenanceReceiptId {
  return value as MemoryMaintenanceReceiptId
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

/** Explicit durable fact supported by direct user text after tool argument validation. */
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

/** Exact user correction of one existing provider-issued memory. */
export interface UpdateMemoryRequest {
  readonly id: MemoryId
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
    /** Exact supporting quote from the captured direct user text. */
    readonly evidence: string
    readonly keywords: readonly string[]
    readonly confidence: number
  }
  | {
    readonly action: 'delete'
    readonly id: MemoryId
    /** Exact supporting quote from the captured direct user text. */
    readonly evidence: string
  }
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

/** One committed automatic change shown in the originating conversation. */
export interface MemoryMaintenanceChange {
  readonly action: 'created' | 'updated' | 'deleted'
  readonly id: MemoryId
  readonly kind: MemoryKind
  readonly title: string
}

/** Commit outcome for one captured turn. */
export interface MemoryMaintenanceOutcome {
  /** Durable delivery identity for a committed changed or unchanged outcome. */
  readonly receiptId?: MemoryMaintenanceReceiptId
  readonly sessionId: SessionId
  readonly turn: number
  readonly status: 'changed' | 'unchanged' | 'failed'
  readonly changes: readonly MemoryMaintenanceChange[]
}

/** Result of one bounded pending-capture maintenance pass. */
export interface MemoryMaintenanceResult {
  readonly processed: number
  readonly failed: number
  readonly pending: number
  readonly outcomes: readonly MemoryMaintenanceOutcome[]
}

/** Cancellation carried beside one provider operation. */
export interface MemoryOperationOptions {
  readonly signal?: AbortSignal
}

/** Cancellation plus an optional originating-session filter for one maintenance pass. */
export interface MemoryMaintenanceOptions extends MemoryOperationOptions {
  /** Process only captures owned by this session when supplied. */
  readonly sessionId?: SessionId
}

declare module '@voyaseek-ai/cordis' {
  interface Context {
    agentMemory: AgentMemory
  }
}

declare module '@voyaseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Reports the committed automatic memory-maintenance outcome for one completed turn.
     * The event is informational: it changes neither model history nor session reconstruction.
     */
    'agent-memory/maintenance': {
      receiptId?: MemoryMaintenanceReceiptId
      turn: number
      status: MemoryMaintenanceOutcome['status']
      changes: readonly MemoryMaintenanceChange[]
    }
  }
}

/** Provider-neutral service consumed by context, tool, and management plugins. */
export abstract class AgentMemory extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentMemory')
  }

  /**
   * Read current configuration, item count, and pending maintenance state.
   * @returns current provider status.
   */
  abstract status(): AgentMemoryStatus

  /**
   * Durably queue one completed turn after provider-owned secret filtering.
   * @param request - trusted Session-derived completed turn.
   * @param options - optional cancellation.
   * @returns queue outcome.
   */
  abstract capture(
    request: CaptureMemoryRequest,
    options?: MemoryOperationOptions,
  ): Promise<'queued' | 'duplicate' | 'disabled' | 'filtered'>

  /**
   * Process durable pending captures through the supplied automatic maintainer.
   * @param maintainer - candidate-aware extractor and consolidation callback.
   * @param options - optional cancellation.
   * @returns bounded pass counts.
   */
  abstract maintain(
    maintainer: MemoryMaintainer,
    options?: MemoryMaintenanceOptions,
  ): Promise<MemoryMaintenanceResult>

  /**
   * Mark committed maintenance receipts delivered after their Session events flush.
   * Providers that return `receiptId` from {@link maintain} must override this method.
   * @param receiptIds - exact provider-issued receipt identities.
   * @param options - optional cancellation.
   * @returns number newly acknowledged.
   */
  acknowledgeMaintenance(
    receiptIds: readonly MemoryMaintenanceReceiptId[],
    options?: MemoryOperationOptions,
  ): Promise<number> {
    void receiptIds
    void options
    return Promise.reject(new Error('agent-memory provider does not support durable maintenance receipts'))
  }

  /**
   * Store or replace one explicit structured memory.
   * @param request - trusted Session-derived explicit memory.
   * @param options - optional cancellation.
   * @returns committed item.
   */
  abstract remember(request: RememberMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem>

  /**
   * Correct one existing item without changing its identity, kind, scope, or origin.
   * @param request - exact provider-issued identity and replacement user-visible fields.
   * @param options - optional cancellation.
   * @returns committed item.
   * @throws when the item does not exist or the replacement contains sensitive content.
   */
  abstract update(request: UpdateMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem>

  /**
   * Recall relevant, unexpired items in provider-defined rank order.
   * @param request - trusted query and scope.
   * @param options - optional cancellation.
   * @returns ordered matching items.
   */
  abstract recall(request: RecallMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem[]>

  /**
   * List stored items newest first for a local management surface.
   * @param options - optional cancellation.
   * @returns every user-manageable item.
   */
  abstract list(options?: MemoryOperationOptions): Promise<MemoryItem[]>

  /**
   * Delete explicitly identified items.
   * @param ids - exact provider-issued identities.
   * @param options - optional cancellation.
   * @returns number deleted.
   */
  abstract forget(ids: readonly MemoryId[], options?: MemoryOperationOptions): Promise<number>

  /**
   * Delete every stored item and pending capture while retaining configuration.
   * @param options - optional cancellation.
   * @returns number of committed items deleted.
   */
  abstract clear(options?: MemoryOperationOptions): Promise<number>
}

export default AgentMemory
