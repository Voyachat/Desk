import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as cloudEntry from '../src/client/index.ts'
import * as productCloudEntry from '../../client-product/src/cloud-client/index.ts'

const root = resolve(import.meta.dirname, '..')

describe('cloud client product wrapper', () => {
  it('reuses the explicit Cloud entry without selecting the Fixture entry', () => {
    expect(cloudEntry.apply).toBe(productCloudEntry.apply)
    expect(cloudEntry.inject).toEqual(['slots', 'employeeExperience'])

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
    expect(manifest.name).toBe('@deepseek-ai/dsh-aistaff-cloud-client-product')
    expect(manifest.dsh.client.inject[0]).toBe('@deepseek-ai/dsh-aistaff-employee-experience-remote')
    expect(build).toContain('banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}')
    expect(build).not.toContain('`${PACKAGE_ID}/cloud-client`')
  })
})
