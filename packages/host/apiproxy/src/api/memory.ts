/** Browser-safe, loopback-only long-term memory management contract. */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One structured memory projected without Host paths or provider credentials. */
export interface MemoryEntryView {
  id: string
  kind: 'preference' | 'fact' | 'constraint' | 'event'
  key: string
  title: string
  content: string
  keywords: string[]
  confidence: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
  workspace?: string
  source: { sessionId: string; turn: number; mode: 'automatic' | 'explicit' }
}

/** Loopback-only management methods; configuration remains in settings.*. */
export interface MemoryApi {
  /** List structured items and maintenance status. */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{
    entries: MemoryEntryView[]
    pendingCount: number
    failedCount: number
    maxEntries: number
  }>>
  /** Delete exact provider-issued memory identities. */
  forget(request: RpcRequest<{ ids: string[] }>): Promise<RpcResponse<{ deleted: number }>>
  /** Delete all structured items and queued captures. */
  clear(request: RpcRequest<{}>): Promise<RpcResponse<{ deleted: number }>>
}
