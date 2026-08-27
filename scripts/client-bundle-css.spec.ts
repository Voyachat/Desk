/**
 * Stylesheets enter client bundles through virtual modules, so the loader must
 * register their physical files as watch dependencies, and the virtual ids must
 * stay repository-relative so built bundles never embed a build-machine path.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { clientBundle } from '../packages/client/tsdown.client.ts'

interface CssPlugin {
  name: string
  resolveId?: (source: string, importer?: string) => string | null
  load?: (this: { addWatchFile(id: string): void }, id: string) => Promise<string | null>
}

function cssPlugin(name: 'dsh-css-modules-inline' | 'dsh-css-global-inline' | 'dsh-css-text-inline'): CssPlugin {
  const configs = clientBundle(
    '@voyaseek-ai/dsh-client-test',
    ['lib/types/index.js', 'lib/types/invariant.js'],
  )({ env: { DSH_BUILD_FACE: 'client' } })
  const client = configs.find(config => config.platform === 'browser')
  if (client === undefined) throw new Error('client config missing')
  const plugins = (client as { plugins: CssPlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === name)
  if (plugin === undefined) throw new Error(`${name} missing from client config`)
  return plugin
}

describe('client bundle CSS Modules', () => {
  it('registers the repository stylesheet without exposing its absolute path', async () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/chat/StatsLine.module.css',
      import.meta.url,
    ))
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/chat/StatsLine.tsx',
      import.meta.url,
    ))
    const plugin = cssPlugin('dsh-css-modules-inline')
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

describe('client bundle global CSS', () => {
  it('compiles a side-effect stylesheet into a watched style injector', async () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-theme/src/styles/base.css',
      import.meta.url,
    ))
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-theme/src/client/styles.ts',
      import.meta.url,
    ))
    const plugin = cssPlugin('dsh-css-global-inline')
    const virtualId = plugin.resolveId?.('../styles/base.css', importer)
    if (typeof virtualId !== 'string' || plugin.load === undefined) {
      throw new Error('global CSS plugin hooks are incomplete')
    }
    const watched: string[] = []

    const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

    expect(virtualId).toBe('\0dsh-global-css:packages/client/ui-theme/src/styles/base.css.mjs')
    expect(virtualId).not.toContain(repositoryRoot)
    expect(watched).toEqual([stylesheet])
    expect(output).toContain('data-plugin-css')
  })

  it('compiles inline stylesheets as watched text without a module side effect', async () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-theme/src/styles/scrollbar.css',
      import.meta.url,
    ))
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-theme/src/client/styles.ts',
      import.meta.url,
    ))
    const plugin = cssPlugin('dsh-css-text-inline')
    const virtualId = plugin.resolveId?.('../styles/scrollbar.css?inline', importer)
    if (typeof virtualId !== 'string' || plugin.load === undefined) {
      throw new Error('inline CSS plugin hooks are incomplete')
    }
    const watched: string[] = []

    const output = await plugin.load.call({ addWatchFile: id => watched.push(id) }, virtualId)

    expect(virtualId).toBe('\0dsh-inline-css:packages/client/ui-theme/src/styles/scrollbar.css.mjs')
    expect(virtualId).not.toContain(repositoryRoot)
    expect(watched).toEqual([stylesheet])
    expect(output).toMatch(/^export default "/)
    expect(output).not.toContain('data-plugin-css')
  })
})
