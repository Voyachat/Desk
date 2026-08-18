import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform } from 'lightningcss'
import type { UserConfig } from 'tsdown'
import { CLIENT_EXTERNALS, clientBundle } from '../../client/tsdown.client.ts'

const PACKAGE_ID = '@voyaseek-ai/dsh-aistaff-client-product'
const CSS_PREFIX = '\0aistaff-cloud-css:'
const CSS_SUFFIX = '.mjs'
const cssFiles = new Map<string, string>()

/** Resolve an emitted CSS import back to this package's source tree. */
function cssSource(source: string, importer: string): string {
  const emitted = resolve(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const marker = '/lib/types/'
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolve(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/** Explicit second browser artifact; the default `./client` remains the Fixture entry. */
const cloudClient: UserConfig = {
  name: `${PACKAGE_ID}/cloud-client`,
  entry: { 'cloud-client': 'lib/types/cloud-client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  plugins: [{
    name: 'aistaff-cloud-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : cssSource(source, importer)
      const id = CSS_PREFIX + basename(file) + CSS_SUFFIX
      cssFiles.set(id, file)
      return id
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = cssFiles.get(id)
      if (file === undefined) throw new Error(`missing CSS source for ${id}`)
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports: cssExports } = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, value] of Object.entries(cssExports ?? {})) classMap[local] = value.name
      const styleId = `${PACKAGE_ID}/cloud-client`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const styleId = ${JSON.stringify(styleId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {',
        '  const tag = document.createElement("style");',
        `  tag.dataset.plugin = ${JSON.stringify(PACKAGE_ID)};`,
        '  tag.dataset.pluginCss = styleId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }],
  outputOptions: {
    entryFileNames: 'cloud-client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(`${PACKAGE_ID}/cloud-client`)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default clientBundle(PACKAGE_ID, ['lib/types/index.js', 'lib/types/invariant.js'], {
  companions: [cloudClient],
})
