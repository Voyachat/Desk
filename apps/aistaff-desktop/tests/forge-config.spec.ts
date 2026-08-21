import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('desktop Forge configuration', () => {
  it('ships the Voyaseek product identity and the legal bundle', () => {
    const forgeConfig = require('../forge.config.cjs') as {
      readonly packagerConfig?: {
        readonly appBundleId?: string
        readonly executableName?: string
        readonly name?: string
        readonly extraResource?: readonly string[]
      }
    }
    const packager = forgeConfig.packagerConfig
    expect(packager?.appBundleId).toBe('ai.voyaseek.desktop')
    expect(packager?.executableName).toBe('Voyaseek')
    expect(packager?.name).toBe('Voyaseek')

    // The legal bundle must ride inside Resources/ next to the notices it
    // complements: the user agreement links the MIT text by relative path.
    const resources = packager?.extraResource ?? []
    const legalDir = resources.find(entry => entry.endsWith('legal'))
    expect(legalDir).toBeDefined()
    expect(existsSync(resolve(legalDir!, 'USER_AGREEMENT.zh-CN.md'))).toBe(true)
    expect(existsSync(resolve(legalDir!, 'third-party', 'deepseek-harness', 'LICENSE'))).toBe(true)
    expect(resources.some(entry => entry.endsWith('THIRD_PARTY_NOTICES.md'))).toBe(true)
    const maintenanceOnly = ['.open-source', '.agents', 'oss_adopt.py', 'rebrand.ts', 'rescope-vendor.ts']
    expect(resources.some(entry => maintenanceOnly.some(marker => entry.includes(marker)))).toBe(false)
  })

  it('uses the default Electron fuse policy', async () => {
    const forgeConfig = require('../forge.config.cjs') as {
      readonly makers?: readonly unknown[]
      readonly packagerConfig?: { readonly icon?: string }
      readonly plugins?: readonly unknown[]
    }

    expect(forgeConfig.plugins).toBeUndefined()
    expect(forgeConfig.makers).toHaveLength(1)
    expect(forgeConfig.makers?.[0]).toBeInstanceOf(MakerDMG)
    const expectedIcon = resolve(import.meta.dirname, '../assets/app-icon.icns')
    expect(forgeConfig.packagerConfig?.icon).toBe(expectedIcon)
    const dmgMaker = forgeConfig.makers?.[0] as MakerDMG
    await dmgMaker.prepareConfig('x64')
    expect(dmgMaker.config.icon).toBe(expectedIcon)
  })
})
