import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@voyaseek-ai/dsh-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
