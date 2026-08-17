// Voyaseek brand mark, monochrome edition (hero and collapsed sidebar rail).
// The full-color mark stays the favicon/PWA icon; the in-app mark ships as
// two theme variants derived from the stacked logo: black ink for light
// backgrounds, white ink for dark ones. The css module switches them on the
// body theme attribute; both stay mounted so theme flips never reflow. The
// export name FishLogo predates the rebrand and is kept so sidebar, hero,
// and test call sites stay untouched; the upstream fish glyph is replaced.

import styles from './FishLogo.module.css'
import type { IconProps } from './icons/props.ts'

/**
 * Render the monochrome Voyaseek mark.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the themed mark img pair (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  const composed = className === undefined ? styles.root : `${styles.root} ${className}`
  return (
    <span className={composed} style={{ width: size, height: size }} aria-hidden="true">
      <img src="/voyaseek-mark-light.png" className={styles.light} alt="" draggable={false} />
      <img src="/voyaseek-mark-dark.png" className={styles.dark} alt="" draggable={false} />
    </span>
  )
}
