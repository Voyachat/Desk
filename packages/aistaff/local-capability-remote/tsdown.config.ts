import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '../../typert/generator/lib/types/tsdown-plugin.js'

export default clientBundle(
  '@voyaseek-ai/dsh-aistaff-local-capability-remote',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  {
    hostPhase: true,
    lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
  },
)
