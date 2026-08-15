import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as strictEntry from '../src/client/index.ts'
import * as productCloudEntry from '../../client-product/src/cloud-client/index.ts'

const root = resolve(import.meta.dirname, '..')

describe('cloud and local client product wrapper', () => {
  it('reuses the explicit production apply while making Local Capability mandatory', () => {
    expect(strictEntry.apply).toBe(productCloudEntry.apply)
    expect(strictEntry.inject).toEqual(['slots', 'employeeExperience', 'localCapability'])

    const source = readFileSync(resolve(root, 'src/client/index.ts'), 'utf8')
    expect(source).toContain('@deepseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts')
    expect(source).not.toMatch(/dsh-aistaff-client-product(?:['"]|\/client['"])/)
  })

  it('declares the wrapper itself as the DSH browser module', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      dsh: { client: { inject: string[] } }
    }
    const build = readFileSync(resolve(root, 'tsdown.config.ts'), 'utf8')
    expect(manifest.name).toBe('@deepseek-ai/dsh-aistaff-cloud-local-client-product')
    expect(manifest.dsh.client.inject).toEqual([
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-aistaff-employee-experience-remote',
      '@deepseek-ai/dsh-aistaff-local-capability-remote',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
    ])
    expect(build).toContain('banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}')
    expect(build).not.toContain('`${PACKAGE_ID}/cloud-client`')
  })

  it('keeps CSS virtual identities relative and the browser artifact Host-free', () => {
    const build = readFileSync(resolve(root, 'tsdown.config.ts'), 'utf8')
    expect(build).toContain('CSS_PREFIX + basename(file) + CSS_SUFFIX')
    expect(build).not.toContain('CSS_PREFIX + file')

    const bundle = readFileSync(resolve(root, 'lib/client.js'), 'utf8')
    expect(bundle).toContain('@deepseek-ai/dsh-aistaff-cloud-local-client-product')
    expect(bundle).not.toContain(root)
    expect(bundle).not.toMatch(/Supervisor|Coordinator|path|token|socket|FsTarget/i)
    expect(bundle).not.toMatch(/fixture|aistaffProductPort/i)
  })
})
