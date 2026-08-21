const path = require('node:path')
const { MakerDMG } = require('@electron-forge/maker-dmg')

const appIcon = path.resolve(__dirname, 'assets/app-icon.icns')

module.exports = {
  packagerConfig: {
    appBundleId: 'ai.voyaseek.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    download: {
      mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' },
    },
    executableName: 'Voyaseek',
    icon: appIcon,
    extraResource: [
      path.resolve(__dirname, '../aistaff-desktop-runtime/runtime'),
      path.resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'),
      // Product legal bundle: user agreement plus the upstream DSH MIT text
      // it references; both must ship inside the app they govern.
      path.resolve(__dirname, 'legal'),
    ],
    ignore: [
      /^\/(?:src|tests)(?:\/|$)/,
      /^\/node_modules(?:\/|$)/,
      /^\/(?:forge\.config\.cjs|package-lock\.json|tsconfig(?:\.test)?\.json|vitest\.config\.ts)$/,
    ],
    name: 'Voyaseek',
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
    new MakerDMG({ format: 'ULFO', icon: appIcon }, ['darwin']),
  ],
}
