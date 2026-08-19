/** Remote-view settings controller behavior over scripted Host wire faces. */

import { describe, expect, it, vi } from 'vitest'
import {
  generateMobileViewToken, MobileViewSettingsStore, parseListenerStatus,
} from '../src/client/store.ts'

function fixture() {
  let enabled = false
  let port = 3081
  let configured = false
  const setCredential = vi.fn(async () => {
    configured = true
    return { rpcId: 'credential-set', result: { ok: true as const, value: { configured: true, writable: true } } }
  })
  const mutate = vi.fn(async (request: { ops: Array<{ path: string[]; value: unknown }> }) => {
    for (const op of request.ops) {
      if (op.path[0] === 'enabled') enabled = op.value as boolean
      if (op.path[0] === 'port') port = op.value as number
    }
    return {
      rpcId: 'settings-mutate',
      result: {
        ok: true as const,
        value: { ns: 'mobile-view', revision: 2, value: { enabled, port } },
      },
    }
  })
  const api = {
    settings: {
      describe: vi.fn(async () => ({
        rpcId: 'settings-describe',
        result: {
          ok: true as const,
          value: {
            writable: true,
            hasDocument: false,
            namespaces: [{ ns: 'mobile-view', revision: 1, value: { enabled, port } }],
          },
        },
      })),
      mutate,
    },
    credentials: {
      describe: vi.fn(async () => ({
        rpcId: 'credentials-describe',
        result: {
          ok: true as const,
          value: {
            credentials: {
              VOYASEEK_MOBILE_VIEW_TOKEN: { configured, writable: true },
            },
          },
        },
      })),
      set: setCredential,
    },
  }
  const readStatus = vi.fn(async () => ({
    requested: enabled,
    listening: enabled,
    port,
    urls: enabled ? [`http://192.168.1.8:${String(port)}/mobile-view`] : [],
  }))
  const controller = new MobileViewSettingsStore(
    api as never,
    readStatus,
    () => Promise.resolve(),
    () => 'generated-token',
  )
  return { controller, mutate, setCredential }
}

describe('mobile-view settings store', () => {
  it('validates listener JSON and generates a 256-bit printable token', () => {
    expect(parseListenerStatus({
      requested: true,
      listening: true,
      port: 3081,
      urls: ['http://192.168.1.8:3081/mobile-view'],
    })).toMatchObject({ listening: true, port: 3081 })
    expect(() => parseListenerStatus({ requested: true, listening: true, port: 0, urls: [] })).toThrow()
    const random = { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) } as Crypto
    expect(generateMobileViewToken(random)).toBe('ab'.repeat(32))
  })

  it('enables with a new write-only token, updates the port, and disables live', async () => {
    const { controller, mutate, setCredential } = fixture()
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'ready', enabled: false, port: 3081 })

    await controller.enable()
    expect(setCredential).toHaveBeenCalledWith({
      ref: 'VOYASEEK_MOBILE_VIEW_TOKEN',
      value: 'generated-token',
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: true,
      visibleToken: 'generated-token',
      listener: { listening: true },
    })

    await controller.setPort(4081)
    expect(controller.store.getSnapshot()).toMatchObject({ port: 4081, listener: { port: 4081 } })

    await controller.disable()
    expect(controller.store.getSnapshot()).toMatchObject({
      enabled: false,
      visibleToken: null,
      listener: { listening: false },
    })
    expect(mutate).toHaveBeenCalledTimes(3)
  })

  it('rejects an invalid port before writing settings', async () => {
    const { controller, mutate } = fixture()
    await controller.load()
    await controller.setPort(0)
    expect(mutate).not.toHaveBeenCalled()
    expect(controller.store.getSnapshot().error).toContain('1')
  })
})
