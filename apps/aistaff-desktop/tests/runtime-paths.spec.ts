import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveSupervisorSidecar } from '../src/runtime-paths.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop runtime paths', () => {
  it('resolves the packaged Supervisor sidecar inside Resources/runtime', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'aistaff-resources-'))
    temporaryDirectories.push(resourcesPath)
    const sidecar = join(resourcesPath, 'runtime', 'native', 'aistaff-desktop-supervisor')
    mkdirSync(join(resourcesPath, 'runtime', 'native'), { recursive: true })
    writeFileSync(sidecar, 'test sidecar')
    chmodSync(sidecar, 0o755)

    expect(resolveSupervisorSidecar(true, resourcesPath, '/unused/app.asar')).toBe(sidecar)
  })

  it('fails loud when the packaged Supervisor sidecar is missing', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'aistaff-resources-'))
    temporaryDirectories.push(resourcesPath)

    expect(() => resolveSupervisorSidecar(true, resourcesPath, '/unused/app.asar'))
      .toThrowError(`Bundled Supervisor sidecar is missing: ${join(
        resourcesPath,
        'runtime',
        'native',
        'aistaff-desktop-supervisor',
      )}`)
  })
})
