import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  name: '@voyaseek-ai/dsh-aistaff-local-capability-conformance',
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default config
