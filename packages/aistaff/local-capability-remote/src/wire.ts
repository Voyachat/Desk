const FORBIDDEN_KEY = /(?:path|socket|token|fstarget|targetkey)/i
const LOCAL_LOCATION = /^(?:\/|file:|unix:|pipe:|\\\\|[a-z]:[\\/])/i

/**
 * Reject privileged or non-JSON values before they can cross the Renderer wire.
 * @param value - candidate input or result tree.
 */
export function assertLocalCapabilityWireValue(value: unknown): void {
  const seen = new Set<object>()
  visit(value, seen)
}

function visit(value: unknown, seen: Set<object>): void {
  if (typeof value === 'string') {
    if (LOCAL_LOCATION.test(value)) throw new TypeError('local capability remote: local location is forbidden on the wire')
    return
  }
  if (value === null || typeof value !== 'object') return
  if (value instanceof Uint8Array) {
    throw new TypeError('local capability remote: binary payload is forbidden on the wire')
  }
  if (seen.has(value)) throw new TypeError('local capability remote: cyclic payload is forbidden on the wire')
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) visit(item, seen)
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new TypeError(`local capability remote: privileged field ${key} is forbidden on the wire`)
      }
      visit(item, seen)
    }
  }
  seen.delete(value)
}
