import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '../../typert/generator/lib/types/tsdown-plugin.js'

export default clientBundle(
  '@deepseek-ai/dsh-aistaff-product-remote',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    hostPhase: true,
    lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
  },
)
