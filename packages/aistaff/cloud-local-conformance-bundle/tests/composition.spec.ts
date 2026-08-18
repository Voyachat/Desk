import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const expected = [
  '@voyaseek-ai/dsh-aistaff-cloud-conformance',
  '@voyaseek-ai/dsh-aistaff-cloud-provider',
  '@voyaseek-ai/dsh-aistaff-cloud-local-conformance',
  '@voyaseek-ai/dsh-aistaff-employee-experience-remote',
  '@voyaseek-ai/dsh-aistaff-local-capability-remote',
  '@voyaseek-ai/dsh-aistaff-cloud-local-client-product',
]
const forbidden = [
  '@voyaseek-ai/dsh-aistaff-supervisor-process',
  '@voyaseek-ai/dsh-aistaff-cloud-product-bundle',
  '@voyaseek-ai/dsh-aistaff-cloud-conformance-bundle',
  '@voyaseek-ai/dsh-aistaff-client-product',
]

describe('test-only Cloud local-read conformance composition', () => {
  it('loads the fixture, production seams, both Remotes, and strict V2 client in order', () => {
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map(match => match[1])
    expect(names).toEqual(expected)
    for (const name of forbidden) expect(names).not.toContain(name)
  })

  it('fixes the local_read scenario and explicit Host service dependencies', () => {
    const patch = readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("scenario: 'local_read'")
    expect(patch).toMatch(/id: aistaff-cloud-provider[\s\S]*?inject: \[aistaffClientGatewayInputs\]/)
    expect(patch).toMatch(/id: aistaff-cloud-local-conformance[\s\S]*?inject: \[aistaffCloudConformance\]/)
    expect(patch).toContain("protocolOffer: '1.0-1.7'")
    expect(patch).toContain('requestTimeoutMs: 5000')
    expect(patch).toContain('pageLimit: 20')
    expect(patch).toContain('selectionRenewalSkewMs: 30000')
    expect(patch).toContain('reconnectDelayMs: 10')
  })

  it('declares every inserted package for Host and Web scaffold resolution', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      description: string
      dsh: { bundle: { patch: string } }
    }
    expect(Object.keys(manifest.dependencies).sort()).toEqual([...expected].sort())
    expect(manifest.description).toContain('Test-only')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    for (const name of forbidden) expect(manifest.dependencies).not.toHaveProperty(name)
  })
})
