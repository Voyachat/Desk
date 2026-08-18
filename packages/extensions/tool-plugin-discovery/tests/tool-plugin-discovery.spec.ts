import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import * as PluginDiscovery from '../src/index.ts'
import { createPluginDirectory, parsePluginCatalog, searchPluginCatalog } from '../src/directory.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const catalog = parsePluginCatalog({
  updated: '2026-08-18',
  plugins: [
    {
      name: 'dsh-ocr',
      owner: 'example',
      url: 'https://github.com/example/dsh-ocr',
      category: 'tools',
      description: { en: 'Local OCR', zh: '本机 OCR' },
      install: 'dsh plugin --profile web add github:example/dsh-ocr',
      added: '2026-08-17',
    },
    {
      name: 'dsh-remote',
      owner: 'example',
      url: 'https://github.com/example/dsh-remote',
      category: 'ui',
      description: { en: 'Mobile remote view', zh: '手机远程查看' },
      install: 'not-installable',
      added: '2026-08-18',
    },
  ],
})

describe('plugin directory', () => {
  it('validates external catalog fields and rejects malformed entries', () => {
    expect(catalog.plugins).toHaveLength(2)
    expect(() => parsePluginCatalog({ plugins: [{ name: 'incomplete' }] }))
      .toThrow('entry 0 has invalid fields')
  })

  it('searches all localized fields and never presents catalog inclusion as review', () => {
    expect(searchPluginCatalog(catalog, '本机 OCR', 8, 'zh')).toEqual([{
      name: 'dsh-ocr',
      owner: 'example',
      url: 'https://github.com/example/dsh-ocr',
      category: 'tools',
      description: '本机 OCR',
      packageSpec: 'github:example/dsh-ocr',
      added: '2026-08-17',
      reviewStatus: 'unreviewed',
    }])
    expect(searchPluginCatalog(catalog, 'remote', 8, 'de')[0]?.description).toBe('Mobile remote view')
  })

  it('loads once, validates before caching, and forwards caller cancellation', async () => {
    const response = new Response(JSON.stringify({ updated: catalog.updated, plugins: catalog.plugins }))
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit) => response.clone())
    const directory = createPluginDirectory({
      catalogUrl: 'https://catalog.invalid/plugins.json',
      requestTimeoutMs: 1_000,
      cacheTtlMs: 60_000,
      fetch,
      now: () => 10,
    })
    const signal = new AbortController().signal

    expect((await directory.search('ocr', 8, 'en', signal)).source).toBe('live')
    expect((await directory.search('ocr', 8, 'en', signal)).source).toBe('cache')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('tool-plugin-discovery plugin', () => {
  it('registers and disposes the read-only discovery tool', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(PluginDiscovery, {})

    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['find_dsh_plugin'])
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('fails load on invalid timeout configuration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await expect(ctx.plugin(PluginDiscovery, { requestTimeoutMs: 0 }))
      .rejects.toThrow('requestTimeoutMs must be a positive integer')
  })
})
