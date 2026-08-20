// @vitest-environment jsdom
import { Context } from '@voyaseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@voyaseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { VoyaseekBrandMark, VoyaseekBrandName } from '../src/client/Brand.tsx'

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

function GenericOccupant() {
  return null
}

afterEach(cleanup)

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('Aistaff browser-brand plugin', () => {
  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('wins each single slot over a generic distribution occupant', async () => {
    const subject = await bench()
    for (const hole of HOLES) subject.slots.register({ name: hole }, GenericOccupant)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()

    for (const hole of HOLES) {
      const entries = subject.slots.entries(hole)
      expect(entries).toHaveLength(2)
      expect(entries[0]?.options.priority).toBe(-100)
      expect(entries[1]?.component).toBe(GenericOccupant)
    }
  })

  it('renders the existing themed Voyaseek artwork at both mark sizes', () => {
    const name = render(<VoyaseekBrandName />)
    expect([...name.container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      '/voyaseek-wordmark-light.png',
      '/voyaseek-wordmark-dark.png',
    ])
    name.unmount()

    const mark = render(<VoyaseekBrandMark size={34} className="hero-mark" />)
    const wrapper = mark.container.firstElementChild as HTMLElement
    expect(wrapper.style.width).toBe('34px')
    expect(wrapper.classList.contains('hero-mark')).toBe(true)
    expect([...mark.container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      '/voyaseek-mark-light.png',
      '/voyaseek-mark-dark.png',
    ])
    mark.rerender(<VoyaseekBrandMark size={24} />)
    expect((mark.container.firstElementChild as HTMLElement).style.width).toBe('24px')
  })
})
