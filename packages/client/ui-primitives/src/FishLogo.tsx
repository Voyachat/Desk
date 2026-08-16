// Voyaseek brand mark (square app/avatar art served by the web shell). The
// export name FishLogo predates the rebrand and is kept so sidebar, hero,
// and test call sites stay untouched; the upstream fish glyph is replaced.
// The mark is opaque raster art: it carries its own plate, so it does not
// ride currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the Voyaseek mark.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the mark img (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <img
      src="/voyaseek-mark.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
