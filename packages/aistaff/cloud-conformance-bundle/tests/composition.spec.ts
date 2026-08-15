import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const expected = [
  '@deepseek-ai/dsh-aistaff-cloud-conformance',
  '@deepseek-ai/dsh-aistaff-cloud-provider',
  '@deepseek-ai/dsh-aistaff-employee-experience-remote',
  '@deepseek-ai/dsh-aistaff-cloud-client-product',
]
const forbidden = [
  '@deepseek-ai/dsh-aistaff-product-projection',
  '@deepseek-ai/dsh-aistaff-product-remote',
  '@deepseek-ai/dsh-aistaff-client-product',
]

describe('test-only Cloud conformance composition', () => {
  it('loads conformance inputs before the production chain', () => {
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map(match => match[1])
    expect(names).toEqual(expected)
    for (const name of forbidden) expect(names).not.toContain(name)
  })

  it('requires an explicit test-only dependency', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      description: string
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
    expect(manifest.description).toContain('Test-only')
  })
})
