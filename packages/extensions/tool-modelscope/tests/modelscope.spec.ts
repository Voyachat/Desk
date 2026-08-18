import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { CallId } from '@voyaseek-ai/dsh-llm'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import type { SubprocessSpawnSpec } from '@voyaseek-ai/dsh-subprocess'
import * as ToolModelScope from '../src/index.ts'
import { parseResult } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('ModelScope result validation', () => {
  it('accepts bounded official model metadata', () => {
    expect(parseResult(JSON.stringify({
      total: 2,
      models: [{ id: 'Qwen/Qwen3', downloads: 10, likes: 2, license: 'apache-2.0', visibility: 'public' }],
    }), 8)).toEqual({
      total: 2,
      models: [{ id: 'Qwen/Qwen3', downloads: 10, likes: 2, license: 'apache-2.0', visibility: 'public' }],
    })
  })

  it('rejects malformed or over-limit child output', () => {
    expect(() => parseResult('{"total":1,"models":[{"id":"x"}]}', 8)).toThrow(/invalid Hub model/)
    expect(() => parseResult('{"total":2,"models":[{"id":"a","downloads":1,"likes":1,"license":null,"visibility":"public"},{"id":"b","downloads":1,"likes":1,"license":null,"visibility":"public"}]}', 1)).toThrow(/invalid Hub response/)
  })
})

describe('ModelScope tool', () => {
  it('runs the pinned official client without a shell and keeps the token out of argv', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    let captured: SubprocessSpawnSpec | undefined
    ctx.provide('subprocess', {
      resolveExecutable: async () => '/usr/local/bin/uv',
      spawn: (spec: SubprocessSpawnSpec) => {
        captured = spec
        return {
          pid: 1,
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          collected: {
            stdout: { readFrom: () => ({
              text: JSON.stringify({
                total: 1,
                models: [{ id: 'PaddlePaddle/PaddleOCR-VL-1.6', downloads: 12, likes: 3, license: 'apache-2.0', visibility: 'public' }],
              }),
              nextOffset: 1,
              lossy: false,
            }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => {},
          waitForExit: () => Promise.resolve(true),
        }
      },
    } as never)
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'private-token', source: 'fixture' }),
    } as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(ToolModelScope, {})

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('modelscope-test'),
      name: 'modelscope_search',
      arguments: { query: 'OCR', limit: 3 },
    })

    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ total: 1, models: [{ id: 'PaddlePaddle/PaddleOCR-VL-1.6' }] })
    expect(captured?.argv.slice(0, 7)).toEqual([
      '/usr/local/bin/uv', 'run', '--no-project', '--with', 'modelscope-hub==0.2.0', 'python', '-c',
    ])
    expect(captured?.argv).not.toContain('private-token')
    expect(captured?.env).toEqual({ MODELSCOPE_API_TOKEN: 'private-token' })

    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})
