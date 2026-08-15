const path = require('node:path')
const { MakerDMG } = require('@electron-forge/maker-dmg')
const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

module.exports = {
  packagerConfig: {
    appBundleId: 'ai.deepseek.aistaff',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    download: {
      mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' },
    },
    executableName: 'AI Staff',
    extraResource: [
      path.resolve(__dirname, '../aistaff-desktop-runtime/runtime'),
      path.resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'),
    ],
    ignore: [
      /^\/(?:src|tests)(?:\/|$)/,
      /^\/node_modules(?:\/|$)/,
      /^\/(?:forge\.config\.cjs|package-lock\.json|tsconfig(?:\.test)?\.json|vitest\.config\.ts)$/,
    ],
    name: 'AI Staff',
    osxSign: false,
    prune: false,
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
      },
    },
  },
  makers: [
    new MakerDMG({ format: 'ULFO' }, ['darwin']),
  ],
  plugins: [
    new FusesPlugin({
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
    }),
  ],
}
