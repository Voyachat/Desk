import { Context } from '@voyaseek-ai/cordis'
import type { ConnectionHandle } from '@voyaseek-ai/dsh-client-connection/client'
import * as GatewayClient from '@voyaseek-ai/dsh-api-gateway/client'
import TypertRegistry from '@voyaseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import * as RemoteAssembly from '../src/client/index.ts'

describe('local capability Client Remote assembly', () => {
  it('mounts remote.localCapability and withdraws the complete namespace on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', {
      rpc: { call: vi.fn<ConnectionHandle['rpc']['call']>() },
    } as unknown as ConnectionHandle)
    await ctx.plugin(GatewayClient)
    const assembly = ctx.plugin(RemoteAssembly)
    await assembly

    expect(ctx.get('remote.localCapability')).toBeDefined()
    expect(ctx.remote.localCapability).toMatchObject({
      getSnapshot: expect.any(Function),
      selectDirectory: expect.any(Function),
      authorizeLocalOperation: expect.any(Function),
      revokeResource: expect.any(Function),
      readOperation: expect.any(Function),
    })
    expect(ctx.get('remote.employeeExperience')).toBeDefined()

    await assembly.dispose()
    expect(ctx.get('remote.localCapability')).toBeUndefined()
    expect(ctx.get('remote.employeeExperience')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
