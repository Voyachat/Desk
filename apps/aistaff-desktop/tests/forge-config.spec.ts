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
        readonly appVersion?: string
        readonly buildVersion?: string
        readonly executableName?: string
        readonly name?: string
        readonly extraResource?: readonly string[]
      }
    }
    const packager = forgeConfig.packagerConfig
    // The comparison build must not collide with the stable install: a
    // distinct bundle identifier and app name also give it a distinct
    // macOS userData directory.
    expect(packager?.appBundleId).toBe('ai.voyaseek.desktop.v02')
    expect(packager?.appVersion).toBe('0.2')
    expect(packager?.buildVersion).toBe('0.1.0-rc.8')
    expect(packager?.executableName).toBe('Voyaseek 0.2')
    expect(packager?.name).toBe('Voyaseek 0.2')

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

  it('uses Electron default fuses and keeps the macOS package configuration', async () => {
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
    expect(dmgMaker.config.name).toBe('Voyaseek 0.2')
  })
})
