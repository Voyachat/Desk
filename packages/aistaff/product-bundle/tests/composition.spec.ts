import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const expected = [
  '@voyaseek-ai/dsh-aistaff-product-projection',
  '@voyaseek-ai/dsh-aistaff-product-remote',
  '@voyaseek-ai/dsh-aistaff-language-policy',
  '@voyaseek-ai/dsh-aistaff-client-brand',
  '@voyaseek-ai/dsh-aistaff-client-product',
]

describe('Aistaff product composition', () => {
  it('installs the product-owned browser brand in the Aistaff layer', () => {
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map(match => match[1])
    expect(names).toEqual(expected)
    expect(names).toContain('@voyaseek-ai/dsh-aistaff-client-brand')
  })

  it('keeps every inserted product plugin in the bundle dependency set', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })
})
