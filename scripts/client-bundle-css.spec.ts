/**
 * CSS Modules enter client bundles through virtual modules, so the loader must
 * explicitly register the underlying stylesheet as a watch dependency.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clientBundle } from '../packages/client/tsdown.client.ts'

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

function cssPlugin(): CssPlugin {
  const configs = clientBundle(
    '@voyaseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'dsh-css-modules-inline')
  if (plugin === undefined) throw new Error('CSS Modules plugin missing from client config')
  return plugin
}

describe('client bundle CSS Modules', () => {
  it('registers the source stylesheet as a watch dependency', async () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/chat/StatsLine.module.css',
      import.meta.url,
    ))
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/chat/StatsLine.tsx',
      import.meta.url,
    ))
    const plugin = cssPlugin()
    const virtualId = plugin.resolveId?.('./StatsLine.module.css', importer)
    if (typeof virtualId !== 'string' || plugin.load === undefined) {
      throw new Error('CSS Modules plugin hooks are incomplete')
    }
    const watched: string[] = []

    const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

    expect(virtualId).toBe('\0dsh-css:packages/client/ui-conversation/src/client/chat/StatsLine.module.css.mjs')
    expect(virtualId).not.toContain(repositoryRoot)
    expect(watched).toEqual([stylesheet])
    expect(output).toContain('data-plugin-css')
  })
})
