import type { SVGProps } from 'react'

export type IconName = 'panel' | 'plus' | 'search' | 'tune' | 'folder' | 'settings' | 'chevron' | 'send' | 'copy' | 'download' | 'close' | 'chat' | 'clock' | 'robot' | 'inbox' | 'file' | 'check' | 'warning' | 'spark' | 'more'

const paths: Record<IconName, readonly string[]> = {
  panel: ['M3 3h10v10H3z', 'M6 3v10'],
  plus: ['M8 3v10', 'M3 8h10'],
  search: ['M7 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z', 'm11 11 3 3'],
  tune: ['M2 4h12', 'M2 8h12', 'M2 12h12', 'M5 2v4', 'M11 6v4', 'M7 10v4'],
  folder: ['M1.8 4.5h4l1.3 1.6h7.1v6.8H1.8z'],
  settings: ['M8 5.5A2.5 2.5 0 1 0 8 10.5 2.5 2.5 0 0 0 8 5.5Z', 'M6.7 1.7h2.6l.4 1.6 1.3.8 1.6-.5 1.3 2.3-1.2 1.1v1.6l1.2 1.1-1.3 2.3-1.6-.5-1.3.8-.4 1.6H6.7l-.4-1.6-1.3-.8-1.6.5-1.3-2.3 1.2-1.1V8.4L2.1 7.3 3.4 5l1.6.5 1.3-.8z'],
  chevron: ['m4 6 4 4 4-4'],
  send: ['M2 8 14 2l-4 12-2.3-4.5z', 'M7.7 9.5 14 2'],
  copy: ['M5 5h8v8H5z', 'M3 11H2V2h9v1'],
  download: ['M8 2v8', 'm5 7 3 3 3-3', 'M2 13h12'],
  close: ['m3 3 10 10', 'm13 3-10 10'],
  chat: ['M2 2.8h12v8H7l-3.8 2.7.8-2.7H2z'],
  clock: ['M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z', 'M8 4.5V8l2.5 1.5'],
  robot: ['M4 5h8v7H4z', 'M8 2v3', 'M6.2 8h.1', 'M9.7 8h.1', 'M6 10h4'],
  inbox: ['M2 3h12v10H2z', 'm2 9 3-3h6l3 3'],
  file: ['M4 1.8h5l3 3V14H4z', 'M9 1.8v3h3'],
  check: ['m3 8 3 3 7-7'],
  warning: ['M8 2 14 13H2z', 'M8 6v3', 'M8 11h.01'],
  spark: ['M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4z'],
  more: ['M3 8h.01', 'M8 8h.01', 'M13 8h.01'],
}

export function Icon({ name, size = 16, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {paths[name].map((path, index) => <path key={index} d={path} />)}
    </svg>
  )
}
