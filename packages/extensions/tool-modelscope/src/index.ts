/** Read-only ModelScope Hub model discovery tool. */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import { credentialRef } from '@voyaseek-ai/dsh-credentials'
import type {} from '@voyaseek-ai/dsh-subprocess'
import { defineTool } from '@voyaseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-modelscope'
/** Tool registry and managed subprocess runtime required by discovery. */
export const inject = ['tools', 'subprocess']

const DEFAULT_PACKAGE_SPEC = 'modelscope-hub==0.2.0'
const DEFAULT_TOKEN_REF = 'MODELSCOPE_API_TOKEN'
const SEARCH_SCRIPT = [
  'import json, os, sys',
  'from modelscope_hub.api import HubApi',
  'query, limit, endpoint = sys.argv[1], int(sys.argv[2]), sys.argv[3] or None',
  'api = HubApi(token=os.environ.get("MODELSCOPE_API_TOKEN") or None, endpoint=endpoint)',
  'page = api.list_repos("model", search=query, page_size=limit)',
  'print(json.dumps({"total": page.total_count, "models": [{"id": item.repo_id, "downloads": item.downloads, "likes": item.likes, "license": item.license, "visibility": str(item.visibility)} for item in page.items]}, ensure_ascii=False))',
].join('; ')

/** Isolated Python runner and ModelScope endpoint configuration. */
export interface Config {
  /** Bare executable or absolute uv path. */
  runner?: string
  /** Exact official Hub client requirement. */
  packageSpec?: string
  /** Optional ModelScope endpoint override. */
  endpoint?: string
  /** Credential reference used for private catalog access. */
  tokenEnv?: string
  /** Search timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum JSON bytes accepted from the child. */
  maxOutputBytes?: number
}

/** Validated ModelScope tool configuration. */
export const Config: z<Config> = z.object({
  runner: z.string().default('uv'),
  packageSpec: z.string().default(DEFAULT_PACKAGE_SPEC),
  endpoint: z.string(),
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_REF),
  timeoutMs: z.number().step(1).min(1).default(30_000),
  maxOutputBytes: z.number().step(1).min(1).default(256 * 1024),
})

type ResolvedConfig = Required<Omit<Config, 'endpoint'>> & Pick<Config, 'endpoint'>

interface ModelScopeModel {
  readonly id: string
  readonly downloads: number
  readonly likes: number
  readonly license: string | null
  readonly visibility: string
}

interface ModelScopeSearchResult {
  readonly total: number
  readonly models: ModelScopeModel[]
}

/**
 * Validate the bounded JSON emitted by the official Hub client.
 * @param text - complete child stdout.
 * @param limit - maximum accepted model count.
 * @returns validated model metadata.
 */
function parseResult(text: string, limit: number): ModelScopeSearchResult {
  const value = JSON.parse(text) as unknown
  if (typeof value !== 'object' || value === null) throw new Error('modelscope_search: invalid Hub response')
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.total) || !Array.isArray(record.models) || record.models.length > limit) {
    throw new Error('modelscope_search: invalid Hub response')
  }
  const models = record.models.map((item): ModelScopeModel => {
    if (typeof item !== 'object' || item === null) throw new Error('modelscope_search: invalid Hub model')
    const model = item as Record<string, unknown>
    if (typeof model.id !== 'string' || model.id.length === 0
      || !Number.isFinite(model.downloads) || !Number.isFinite(model.likes)
      || !(typeof model.license === 'string' || model.license === null)
      || typeof model.visibility !== 'string') throw new Error('modelscope_search: invalid Hub model')
    return {
      id: model.id,
      downloads: model.downloads as number,
      likes: model.likes as number,
      license: model.license,
      visibility: model.visibility,
    }
  })
  return { total: record.total as number, models }
}

/** Register read-only official ModelScope model discovery. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  ctx.tools.register(defineTool({
    name: 'modelscope_search',
    description: 'Search the official ModelScope Hub model catalog. This read-only tool does not download or execute model code; inspect each model card and license before adoption.',
    parameters: {
      query: { type: 'string', required: true, description: 'Model name, task, architecture, or capability keywords.' },
      limit: { type: 'integer', description: 'Maximum results from 1 through 20. Defaults to 8.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          models: {
            type: 'array', required: true, items: {
              type: 'object', additionalProperties: false, properties: {
                id: { type: 'string', required: true },
                downloads: { type: 'number', required: true },
                likes: { type: 'number', required: true },
                license: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
                visibility: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as unknown as ModelScopeSearchResult
        const lines = result.models.map((model, index) => `${String(index + 1)}. ${model.id} — license ${model.license ?? 'unknown'}, downloads ${String(model.downloads)}, likes ${String(model.likes)}`)
        return [{ type: 'text', text: `${lines.join('\n') || 'No matching ModelScope models.'}\n\nTotal matches: ${String(result.total)}. Search results are not a license or safety review.` }]
      },
    },
    async execute(args, exec) {
      const limit = args.limit ?? 8
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('modelscope_search: limit must be an integer from 1 through 20')
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(resolved.timeoutMs)])
      const executable = await ctx.subprocess.resolveExecutable(resolved.runner, {}, signal)
      const token = await ctx.get('credentials')?.resolve(credentialRef(resolved.tokenEnv))
      const handle = ctx.subprocess.spawn({
        argv: [
          executable, 'run', '--no-project', '--with', resolved.packageSpec, 'python', '-c', SEARCH_SCRIPT,
          args.query, String(limit), resolved.endpoint ?? '',
        ],
        cwd: exec.agent?.session.header.cwd ?? process.cwd(),
        env: token === undefined ? {} : { MODELSCOPE_API_TOKEN: token.value },
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: resolved.maxOutputBytes },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: 2_000,
        signal,
      })
      const outcome = await handle.done
      if (signal.aborted) throw new Error('modelscope_search: search was cancelled or timed out')
      const stdout = handle.collected.stdout?.readFrom(0)
      if (outcome.exitCode !== 0 || outcome.signal !== null || stdout === undefined || stdout.lossy) {
        throw new Error('modelscope_search: official Hub client failed')
      }
      return parseResult(stdout.text.trim(), limit)
    },
  }))
}

export { parseResult }
