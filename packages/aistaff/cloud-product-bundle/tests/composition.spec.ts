import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const expected = [
  '@voyaseek-ai/dsh-aistaff-cloud-provider',
  '@voyaseek-ai/dsh-aistaff-employee-experience-remote',
  '@voyaseek-ai/dsh-aistaff-cloud-client-product',
]
const forbidden = [
  '@voyaseek-ai/dsh-aistaff-cloud-conformance',
  '@voyaseek-ai/dsh-aistaff-product-projection',
  '@voyaseek-ai/dsh-aistaff-product-remote',
  '@voyaseek-ai/dsh-aistaff-client-product',
]

describe('production Cloud product composition', () => {
  it('loads only the production chain in dependency order', () => {
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map(match => match[1])
    expect(names).toEqual(expected)
    for (const name of forbidden) expect(names).not.toContain(name)
  })

  it('keeps the manifest dependency set production-only', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { bundle: { patch: string } }
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })
})
