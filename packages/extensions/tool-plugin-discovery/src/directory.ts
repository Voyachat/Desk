/** Curated DSH plugin directory retrieval and deterministic local search. */

/** One validated entry from the awesome-dsh-plugin catalog. */
export interface CatalogPlugin {
  readonly name: string
  readonly owner: string
  readonly url: string
  readonly category: string
  readonly description: Readonly<Record<string, string>>
  readonly install: string
  readonly added: string
}

/** Validated subset of the remote catalog used by this package. */
export interface PluginCatalog {
  readonly updated: string
  readonly plugins: readonly CatalogPlugin[]
}

/** One model-facing discovery result. */
export interface PluginDiscoveryResult {
  readonly name: string
  readonly owner: string
  readonly url: string
  readonly category: string
  readonly description: string
  readonly packageSpec: string | null
  readonly added: string
  readonly reviewStatus: 'unreviewed'
}

/** Injectable catalog reader used by the plugin-scoped cache and tests. */
export interface CatalogFetch {
  (input: string, init: RequestInit): Promise<Response>
}

/** Runtime values that determine catalog I/O and cache behavior. */
export interface PluginDirectoryOptions {
  readonly catalogUrl: string
  readonly requestTimeoutMs: number
  readonly cacheTtlMs: number
  readonly fetch: CatalogFetch
  readonly now: () => number
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null
}

function parseDescription(value: unknown): Record<string, string> | null {
  const record = object(value)
  if (record === null) return null
  const description: Record<string, string> = {}
  for (const [language, text] of Object.entries(record)) {
    if (typeof text !== 'string') return null
    description[language] = text
  }
  return Object.keys(description).length > 0 ? description : null
}

/**
 * Validate the external catalog before any field reaches tool output.
 * @param value - parsed remote JSON.
 * @returns a catalog containing only validated fields.
 */
export function parsePluginCatalog(value: unknown): PluginCatalog {
  const record = object(value)
  if (record === null || !Array.isArray(record.plugins)) {
    throw new Error('plugin directory returned an invalid catalog')
  }
  const plugins = record.plugins.map((value, index): CatalogPlugin => {
    const plugin = object(value)
    if (plugin === null) throw new Error(`plugin directory entry ${index} is not an object`)
    const name = stringField(plugin, 'name')
    const owner = stringField(plugin, 'owner')
    const url = stringField(plugin, 'url')
    const category = stringField(plugin, 'category')
    const install = stringField(plugin, 'install')
    const added = stringField(plugin, 'added')
    const description = parseDescription(plugin.description)
    if (name === null || owner === null || url === null || category === null
      || install === null || added === null || description === null) {
      throw new Error(`plugin directory entry ${index} has invalid fields`)
    }
    return { name, owner, url, category, description, install, added }
  })
  return {
    updated: typeof record.updated === 'string' ? record.updated : '',
    plugins,
  }
}

function packageSpec(install: string): string | null {
  const match = /^dsh plugin --profile \S+ add (?<spec>\S+)$/.exec(install)
  return match?.groups?.spec ?? null
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function searchable(plugin: CatalogPlugin): string {
  return normalize([
    plugin.name,
    plugin.owner,
    plugin.category,
    ...Object.values(plugin.description),
  ].join(' '))
}

function score(plugin: CatalogPlugin, query: string): number {
  const name = normalize(plugin.name)
  const owner = normalize(plugin.owner)
  if (name === query) return 1_000
  let value = name.includes(query) ? 400 : 0
  if (owner.includes(query)) value += 100
  for (const term of query.split(' ')) {
    if (name.includes(term)) value += 50
    if (normalize(plugin.category).includes(term)) value += 20
  }
  return value
}

/**
 * Search one already-validated catalog without network or side effects.
 * @param catalog - validated catalog to search.
 * @param query - non-empty normalized search terms.
 * @param limit - maximum returned entries.
 * @param language - preferred description language.
 * @returns ranked discovery results.
 */
export function searchPluginCatalog(
  catalog: PluginCatalog,
  query: string,
  limit: number,
  language: string,
): PluginDiscoveryResult[] {
  const normalizedQuery = normalize(query)
  if (normalizedQuery === '') throw new Error('plugin search query must not be empty')
  const terms = normalizedQuery.split(' ')
  return catalog.plugins
    .filter(plugin => terms.every(term => searchable(plugin).includes(term)))
    .sort((left, right) => score(right, normalizedQuery) - score(left, normalizedQuery)
      || right.added.localeCompare(left.added)
      || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map(plugin => ({
      name: plugin.name,
      owner: plugin.owner,
      url: plugin.url,
      category: plugin.category,
      description: plugin.description[language] ?? plugin.description.en ?? Object.values(plugin.description)[0] ?? '',
      packageSpec: packageSpec(plugin.install),
      added: plugin.added,
      reviewStatus: 'unreviewed',
    }))
}

/**
 * Create one plugin-scoped directory reader with a bounded single-catalog cache.
 * @param options - endpoint, timeout, cache, clock, and fetch implementation.
 * @returns a read-only catalog search operation.
 */
export function createPluginDirectory(options: PluginDirectoryOptions): {
  search(query: string, limit: number, language: string, signal: AbortSignal): Promise<{
    updated: string
    source: 'live' | 'cache'
    results: PluginDiscoveryResult[]
  }>
} {
  let cache: { loadedAt: number; catalog: PluginCatalog } | null = null
  return {
    async search(query, limit, language, signal) {
      let source: 'live' | 'cache' = 'cache'
      if (cache === null || options.now() - cache.loadedAt >= options.cacheTtlMs) {
        const combined = AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs)])
        const response = await options.fetch(options.catalogUrl, {
          headers: { accept: 'application/json', 'user-agent': 'voyaseek-plugin-discovery' },
          signal: combined,
        })
        if (!response.ok) throw new Error(`plugin directory HTTP ${response.status}`)
        cache = { loadedAt: options.now(), catalog: parsePluginCatalog(await response.json()) }
        source = 'live'
      }
      return {
        updated: cache.catalog.updated,
        source,
        results: searchPluginCatalog(cache.catalog, query, limit, language),
      }
    },
  }
}
