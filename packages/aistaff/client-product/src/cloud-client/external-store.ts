import type {
  EmployeeExperiencePort,
  EmployeeExperienceSnapshot,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalCapabilityPort,
  LocalCapabilitySnapshot,
} from '@deepseek-ai/dsh-aistaff-local-capability'
import { useSyncExternalStore } from 'react'

/** React-compatible view over the snapshot reference owned by the object layer. */
export interface EmployeeExperienceExternalStore {
  /** Subscribe to reference replacements. */
  readonly subscribe: (listener: () => void) => () => void
  /** Read the exact current immutable object-layer snapshot. */
  readonly getSnapshot: () => EmployeeExperienceSnapshot
  /** Stop the source observation and all future delivery. */
  readonly dispose: () => void
}

/** React-compatible view over the Local Capability object-layer snapshot. */
export interface LocalCapabilityExternalStore {
  /** Subscribe to complete reference replacements. */
  readonly subscribe: (listener: () => void) => () => void
  /** Read the exact current immutable local capability snapshot. */
  readonly getSnapshot: () => LocalCapabilitySnapshot
  /** Stop the source observation and all future delivery. */
  readonly dispose: () => void
}

/**
 * Adapt the atomic Employee Experience observation to React's external-store
 * protocol without copying business projection into a Slot Store.
 * @param port - explicit production Employee Experience service.
 * @returns a stable external store whose snapshot is the object-layer value.
 */
export function createEmployeeExperienceExternalStore(
  port: EmployeeExperiencePort,
): EmployeeExperienceExternalStore {
  let current: EmployeeExperienceSnapshot | undefined
  let active = true
  const listeners = new Set<() => void>()
  const observation = port.observe((replacement) => {
    if (!active) return
    current = replacement
    for (const listener of Array.from(listeners)) listener()
  })
  current = observation.snapshot

  return Object.freeze({
    subscribe(listener: () => void): () => void {
      if (!active) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): EmployeeExperienceSnapshot {
      if (current === undefined) throw new Error('employee experience external store has no initial snapshot')
      return current
    },
    dispose(): void {
      if (!active) return
      active = false
      listeners.clear()
      observation.dispose()
    },
  })
}

/**
 * Adapt the optional Local Capability object layer without copying grants,
 * consents, or Receipts into the Renderer Slot Store.
 * @param port - explicit Client-side Local Capability service.
 * @returns a stable external store over complete path-free replacements.
 */
export function createLocalCapabilityExternalStore(
  port: LocalCapabilityPort,
): LocalCapabilityExternalStore {
  let current: LocalCapabilitySnapshot | undefined
  let active = true
  const listeners = new Set<() => void>()
  const observation = port.observe((replacement) => {
    if (!active) return
    current = replacement
    for (const listener of Array.from(listeners)) listener()
  })
  current = observation.snapshot

  return Object.freeze({
    subscribe(listener: () => void): () => void {
      if (!active) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): LocalCapabilitySnapshot {
      if (current === undefined) throw new Error('local capability external store has no initial snapshot')
      return current
    },
    dispose(): void {
      if (!active) return
      active = false
      listeners.clear()
      observation.dispose()
    },
  })
}

/**
 * Read the current object-layer replacement through React tear prevention.
 * @param store - stable external store created for the plugin lifetime.
 * @returns the current immutable Renderer-safe projection.
 */
export function useEmployeeExperience(
  store: EmployeeExperienceExternalStore,
): EmployeeExperienceSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * Read the current Local Capability replacement through React tear prevention.
 * @param store - stable optional local capability store.
 * @returns the current immutable path-free local projection.
 */
export function useLocalCapability(
  store: LocalCapabilityExternalStore,
): LocalCapabilitySnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
