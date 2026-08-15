import type { AppState, ClientCommand } from '../domain/client-state.ts'

/**
 * Frontend-only host seam. The Demo adapter stores fixture projections locally;
 * the formal Client replaces it with RPC commands and DSH session/workspace stores.
 */
export interface ClientPort {
  getSnapshot(): AppState
  subscribe(listener: () => void): () => void
  dispatch(command: ClientCommand): void
}
