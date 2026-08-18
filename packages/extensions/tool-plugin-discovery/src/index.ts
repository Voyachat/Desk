/** Model-facing discovery over the awesome-dsh-plugin curated catalog. */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import { defineTool } from '@voyaseek-ai/dsh-tools'
import { createPluginDirectory, type PluginDiscoveryResult } from './directory.ts'

export { createPluginDirectory, parsePluginCatalog, searchPluginCatalog } from './directory.ts'
export type {
  CatalogFetch,
  CatalogPlugin,
  PluginCatalog,
  PluginDirectoryOptions,
  PluginDiscoveryResult,
} from './directory.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-plugin-discovery'
/** Services required by this model-facing tool. */
export const inject = ['tools']

const DEFAULT_CATALOG_URL = 'https://awesome-dsh-plugin.com/plugins.json'

/** Deployment-varying catalog endpoint, timeout, and cache policy. */
export interface Config {
  /** Machine-readable awesome-dsh-plugin catalog URL. */
  catalogUrl?: string
  /** Cooperative timeout for one catalog request. */
  requestTimeoutMs?: number
  /** Time to retain the single validated catalog in memory. */
  cacheTtlMs?: number
}

export const Config: z<Config> = z.object({
  catalogUrl: z.string().default(DEFAULT_CATALOG_URL),
  requestTimeoutMs: z.number().default(10_000),
  cacheTtlMs: z.number().default(60 * 60 * 1_000),
})

type ResolvedConfig = Required<Config>

function positiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-plugin-discovery: ${name} must be a positive integer`)
  }
}

function render(results: readonly PluginDiscoveryResult[], updated: string): string {
  if (results.length === 0) return 'No matching curated DSH plugins found.'
  return `${results.map((plugin, index) => [
    `${index + 1}. ${plugin.name} — ${plugin.description}`,
    `   source: ${plugin.url}`,
    `   package: ${plugin.packageSpec ?? 'not declared'}`,
    '   review: unreviewed; inspect and pass the dsh plugin audit before installation',
  ].join('\n')).join('\n\n')}\n\nCatalog updated: ${updated || 'unknown'}. Catalog inclusion is not a security review.`
}

/** Register the read-only `find_dsh_plugin` tool. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  positiveInteger('requestTimeoutMs', resolved.requestTimeoutMs)
  positiveInteger('cacheTtlMs', resolved.cacheTtlMs)
  const directory = createPluginDirectory({
    catalogUrl: resolved.catalogUrl,
    requestTimeoutMs: resolved.requestTimeoutMs,
    cacheTtlMs: resolved.cacheTtlMs,
    fetch,
    now: Date.now,
  })
  ctx.tools.register(defineTool({
    name: 'find_dsh_plugin',
    description: 'Search the curated awesome-dsh-plugin directory. Results are discovery leads, not security approval; do not install one until its exact source passes the dsh plugin audit and the user confirms installation.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Capability keywords, for example "OCR", "mobile remote", or "跨会话记忆".',
      },
      limit: {
        type: 'integer',
        description: 'Maximum results from 1 through 20. Defaults to 8.',
      },
      language: {
        type: 'string',
        description: 'Preferred catalog description language. Defaults to zh.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          updated: { type: 'string', required: true },
          source: { type: 'string', enum: ['live', 'cache'], required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                owner: { type: 'string', required: true },
                url: { type: 'string', required: true },
                category: { type: 'string', required: true },
                description: { type: 'string', required: true },
                packageSpec: {
                  required: true,
                  oneOf: [{ type: 'string' }, { type: 'null' }],
                },
                added: { type: 'string', required: true },
                reviewStatus: { type: 'string', enum: ['unreviewed'], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as unknown as {
          updated: string
          results: PluginDiscoveryResult[]
        }
        return [{ type: 'text', text: render(result.results, result.updated) }]
      },
    },
    async execute(args, exec) {
      const limit = args.limit ?? 8
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new Error('find_dsh_plugin: limit must be an integer from 1 through 20')
      }
      return await directory.search(args.query, limit, args.language ?? 'zh', exec.signal)
    },
  }))
}
