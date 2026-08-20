/** Voyaseek brand occupants installed only by the Aistaff product layer. */
import type { ClientContext } from '@voyaseek-ai/dsh-client-runtime/client'
import type {} from '@voyaseek-ai/dsh-client-ui-conversation/client'
import type {} from '@voyaseek-ai/dsh-client-ui-sidebar/client'
import { VoyaseekBrandMark, VoyaseekBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/** Product occupants must shadow any lower-priority generic distribution brand. */
const PRODUCT_BRAND_PRIORITY = -100

/**
 * Fill all shipped brand slots as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register(
          { name: 'sidebar.brand.mark', priority: PRODUCT_BRAND_PRIORITY },
          VoyaseekBrandMark,
        )
        yield ctx.slots.register(
          { name: 'sidebar.brand.name', priority: PRODUCT_BRAND_PRIORITY },
          VoyaseekBrandName,
        )
        yield ctx.slots.register(
          { name: 'conversation.hero.brand.mark', priority: PRODUCT_BRAND_PRIORITY },
          VoyaseekBrandMark,
        )
      })))
}
