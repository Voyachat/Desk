import { describe, expect, it, vi } from 'vitest'
import { apply as nodeApply } from '../src/index.ts'
import { apply, inject, name } from '../src/invariant.ts'

describe('Aistaff client brand package halves', () => {
  it('keeps the Host half empty and reserves invariant ownership', async () => {
    expect(nodeApply()).toBeUndefined()
    expect(name).toBe('aistaff-client-brand-invariant')
    expect(inject).toEqual(['invariants'])
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _install: () => void) => dispose)
    await expect(apply({ invariants: { register } } as never)).resolves.toBe(dispose)
    expect(register).toHaveBeenCalledWith(
      '@voyaseek-ai/dsh-aistaff-client-brand',
      expect.any(Function),
    )
  })
})
