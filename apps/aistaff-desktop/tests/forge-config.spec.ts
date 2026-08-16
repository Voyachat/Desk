import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('desktop Forge configuration', () => {
  it('keeps the complete Electron fuse policy explicit without OS cookie-key storage', async () => {
    const forgeConfig = require('../forge.config.cjs') as {
      readonly makers?: readonly unknown[]
      readonly packagerConfig?: { readonly icon?: string }
      readonly plugins?: readonly unknown[]
    }
    const fusePlugin = forgeConfig.plugins?.find(
      (plugin): plugin is FusesPlugin => plugin instanceof FusesPlugin,
    )

    expect(fusePlugin).toBeDefined()
    expect(fusePlugin?.fusesConfig).toEqual({
      version: FuseVersion.V1,
      strictlyRequireAllFuses: true,
      [FuseV1Options.RunAsNode]: true,
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
      [FuseV1Options.WasmTrapHandlers]: true,
    })
    expect(forgeConfig.makers).toHaveLength(1)
    expect(forgeConfig.makers?.[0]).toBeInstanceOf(MakerDMG)
    const expectedIcon = resolve(import.meta.dirname, '../assets/app-icon.icns')
    expect(forgeConfig.packagerConfig?.icon).toBe(expectedIcon)
    const dmgMaker = forgeConfig.makers?.[0] as MakerDMG
    await dmgMaker.prepareConfig('x64')
    expect(dmgMaker.config.icon).toBe(expectedIcon)
  })
})
