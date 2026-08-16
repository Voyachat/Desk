// Voyaseek brand wordmark (horizontal logo, 660x180 raster art, ~3.66:1).
// The ink is raster art rather than currentColor paths, so two theme variants
// ship beside the web shell: black lettering for light backgrounds, white
// lettering for dark ones. The css module switches them on the body theme
// attribute; both stay mounted so theme flips never reflow the sidebar.

import styles from './BrandWordmark.module.css'
import type { IconProps } from './icons/props.ts'

/**
 * Render the Voyaseek wordmark.
 * @param props.size - height in px (default 24; width keeps the logo ratio).
 * @param props.className - extra class for layout placement.
 * @returns the themed wordmark img pair (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  const composed = className === undefined ? styles.root : `${styles.root} ${className}`
  return (
    <span className={composed} style={{ height: size }} aria-hidden="true">
      <img src="/voyaseek-wordmark-light.png" className={styles.light} alt="" draggable={false} />
      <img src="/voyaseek-wordmark-dark.png" className={styles.dark} alt="" draggable={false} />
    </span>
  )
}
