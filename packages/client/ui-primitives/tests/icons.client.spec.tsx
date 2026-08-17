// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconApiOutline14, IconArchiveOutline20, IconFolderClose16, IconGoalOutline16, IconSendOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

// Icon components all share the IconProps signature; the barrel also exports
// non-icon atoms (different props shapes), so filter by prefix BEFORE typing.
const icons = Object.fromEntries(
  Object.entries(primitives).filter(([name]) => name.startsWith('Icon')),
) as Record<string, (p: primitives.IconProps) => React.JSX.Element>
const iconNames = Object.keys(icons)

describe('ic_ds_ icon set', () => {
  it('exports the full icon set (46 deepsuite + 20 figma extracts + four product glyphs outside those sets)', () => {
    expect(iconNames.length).toBe(70)
  })

  it.each(iconNames)('%s renders an svg with currentColor fills and no hardcoded palette', (name) => {
    const Icon = icons[name]!
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    const markup = container.innerHTML
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
    expect(markup).toContain('currentColor')
  })

  it('size and className props land on the root svg', () => {
    const { container } = render(<IconSendOutline16 size={20} className="x" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('20')
    expect(svg.getAttribute('height')).toBe('20')
    expect(svg.classList.contains('x')).toBe(true)
  })

  it('each glyph defaults to its own drawn size, not one set-wide default', () => {
    const api = render(<IconApiOutline14 />)
    expect(api.container.querySelector('svg')!.getAttribute('width')).toBe('14')
    const folder = render(<IconFolderClose16 />)
    expect(folder.container.querySelector('svg')!.getAttribute('width')).toBe('16')
    const archive = render(<IconArchiveOutline20 />)
    expect(archive.container.querySelector('svg')!.getAttribute('width')).toBe('20')
  })

  it('renders reusable goal glyphs without document-global ids', () => {
    const { container } = render(<><IconGoalOutline16 /><IconGoalOutline16 /></>)
    expect(container.querySelector('[id]')).toBeNull()
    expect(container.querySelector('[clip-path]')).toBeNull()
  })
})

describe('FishLogo', () => {
  it('renders the monochrome Voyaseek mark pair at the requested square size', () => {
    const { container } = render(<primitives.FishLogo />)
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    const srcs = [...imgs].map(img => img.getAttribute('src'))
    expect(srcs).toEqual(['/voyaseek-mark-light.png', '/voyaseek-mark-dark.png'])
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('24px')
    expect(wrapper.style.height).toBe('24px')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    for (const img of imgs) {
      expect(img.getAttribute('alt')).toBe('')
      expect(img.getAttribute('draggable')).toBe('false')
    }
    expect(container.querySelector('svg')).toBeNull()
  })

  it('forwards size and className to the mark wrapper', () => {
    const { container } = render(<primitives.FishLogo size={34} className="x" />)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('34px')
    expect(wrapper.style.height).toBe('34px')
    expect(wrapper.classList.contains('x')).toBe(true)
  })
})

describe('BrandWordmark', () => {
  it('stacks the theme pair in a fixed 11:3 container', () => {
    const { container } = render(<primitives.BrandWordmark />)
    const wrapper = container.firstElementChild as HTMLElement
    const imgs = container.querySelectorAll('img')
    expect(wrapper.style.width).toBe('88px')
    expect(wrapper.style.height).toBe('24px')
    expect([...imgs].map(img => img.getAttribute('src'))).toEqual([
      '/voyaseek-wordmark-light.png',
      '/voyaseek-wordmark-dark.png',
    ])
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
  })
})
