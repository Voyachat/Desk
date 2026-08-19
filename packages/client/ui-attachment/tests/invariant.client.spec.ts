import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import * as AttachmentInvariant from '@voyaseek-ai/dsh-client-ui-attachment/invariant'
import InvariantRegistry from '@voyaseek-ai/dsh-invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(AttachmentInvariant).await()).resolves.toBeDefined()
  })
})
