import type { HeroBrandMarkOwnerProps } from '@voyaseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@voyaseek-ai/dsh-client-ui-sidebar/client'
import styles from './Brand.module.css'

type VoyaseekBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

const ART_WIDTH = 660
const ART_HEIGHT = 180
const NAME_START = 200

/**
 * Render the themed Voyaseek mark requested by a Client brand slot.
 * @param props - Host-supplied mark presentation.
 * @returns The light and dark mark artwork pair.
 */
export function VoyaseekBrandMark({ size, className }: VoyaseekBrandMarkProps) {
  const composed = className === undefined ? styles.mark : `${styles.mark} ${className}`
  return (
    <span className={composed} style={{ width: size, height: size }} aria-hidden="true">
      <img src="/voyaseek-mark-light.png" className={styles.light} alt="" draggable={false} />
      <img src="/voyaseek-mark-dark.png" className={styles.dark} alt="" draggable={false} />
    </span>
  )
}

/**
 * Render the Voyaseek name artwork without the independently slotted mark.
 * @returns The themed name-only wordmark pair.
 */
export function VoyaseekBrandName() {
  const size = 24
  const fullWidth = size * ART_WIDTH / ART_HEIGHT
  const offset = size * NAME_START / ART_HEIGHT
  const width = fullWidth - offset
  const imageStyle = { width: fullWidth, transform: `translateX(-${offset}px)` }
  return (
    <span className={styles.wordmark} style={{ width, height: size }} aria-hidden="true">
      <img
        src="/voyaseek-wordmark-light.png"
        className={styles.light}
        style={imageStyle}
        alt=""
        draggable={false}
      />
      <img
        src="/voyaseek-wordmark-dark.png"
        className={styles.dark}
        style={imageStyle}
        alt=""
        draggable={false}
      />
    </span>
  )
}
