import type { ReactNode } from 'react'
import css from './AppFrame.module.css'

export interface AppFrameProps {
  collapsed: boolean
  detailsOpen: boolean
  sidebar: ReactNode
  center: ReactNode
  details: ReactNode
}

/** Mirrors DSH root slot geometry: sidebar | conversation | mounted details. */
export function AppFrame({ collapsed, detailsOpen, sidebar, center, details }: AppFrameProps) {
  return (
    <main className={css.frame} data-sidebar-collapsed={collapsed || undefined} data-details-open={detailsOpen || undefined}>
      <aside className={css.sidebar}>{sidebar}</aside>
      <section className={css.center}>{center}</section>
      <aside className={css.details}>{details}</aside>
    </main>
  )
}
