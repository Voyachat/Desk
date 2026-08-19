import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import SessionStore, { SessionId } from '@voyaseek-ai/dsh-session'
import TypertRegistry from '@voyaseek-ai/dsh-typert-registry'

describe('Session Typert provider', () => {
  it('contributes live Session lookup in either service load order', async () => {
    const ctx = new Context()
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create(SessionId('remote-session'))

    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      hostTypeSymbol: '@voyaseek-ai/dsh-session#Session',
      wireTypeSymbol: '@voyaseek-ai/dsh-session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
