const path = require('node:path')
const { MakerDMG } = require('@electron-forge/maker-dmg')

const appIcon = path.resolve(__dirname, 'assets/app-icon.icns')

module.exports = {
  packagerConfig: {
    // The 0.2 comparison build owns a distinct bundle identifier so macOS
    // treats it as a separate application from the stable 0.1.x install.
    appBundleId: 'ai.voyaseek.desktop.v02',
    appCategoryType: 'public.app-category.productivity',
    appVersion: '0.2',
    asar: true,
    buildVersion: '0.1.0-rc.8',
    download: {
      mirrorOptions: { mirror: 'https://npmmirror.com/mirrors/electron/' },
    },
    executableName: 'Voyaseek 0.2',
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
    name: 'Voyaseek 0.2',
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
    new MakerDMG({ format: 'ULFO', icon: appIcon, name: 'Voyaseek 0.2' }, ['darwin']),
  ],
}
