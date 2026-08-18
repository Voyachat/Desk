import { describe, expect, it, vi } from 'vitest'
import { apply as applyNode } from '../src/index.ts'
import {
  apply as applyInvariant,
  inject as invariantInject,
  name as invariantName,
} from '../src/invariant.ts'

describe('client product package halves', () => {
  it('keeps the Host half empty and registers an explained invariant companion', async () => {
    expect(applyNode()).toBeUndefined()
    expect(invariantName).toBe('aistaff-client-product-invariant')
    expect(invariantInject).toEqual(['invariants'])
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _install: () => void) => dispose)
    const result = await applyInvariant({ invariants: { register } } as never)
    expect(result).toBe(dispose)
    expect(register).toHaveBeenCalledWith(
      '@voyaseek-ai/dsh-aistaff-client-product',
      expect.any(Function),
    )
    const install = register.mock.calls[0]![1]
    expect(install()).toBeUndefined()
  })
})
