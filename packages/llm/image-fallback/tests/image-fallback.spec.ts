import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import { AttachmentId } from '@voyaseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter, LlmError } from '@voyaseek-ai/dsh-llm'
import type {
  ContentBlock, GenerateOptions, LlmResolvedModelInfo, StreamChunk,
} from '@voyaseek-ai/dsh-llm'
import { SessionId } from '@voyaseek-ai/dsh-session'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import ImageFallbackService, { ImageFallbackError } from '../src/index.ts'

const imageContent: ContentBlock[] = [{
  type: 'image',
  attachment: {
    attachmentId: AttachmentId('sha256:test'),
    mediaType: 'image/png',
    bytes: 1,
    width: 1,
    height: 1,
    name: 'test.png',
  },
}]

class VisionAdapter extends LlmAdapter {
  readonly calls: string[] = []

  constructor(private readonly behavior: (model: string) => 'success' | string) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options.model)
    const outcome = this.behavior(options.model)
    if (outcome !== 'success') throw new LlmError('vision route failed', outcome)
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Image 1: visible text.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function harness(behavior: (model: string) => 'success' | string) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LlmRuntime)
  ctx.provide('attachments', {} as never)
  const adapter = new VisionAdapter(behavior)
  ctx.llm.registerAdapter(['vision'], adapter)
  await ctx.plugin(ImageFallbackService, {
    local: false,
    routes: [
      { provider: 'vision', model: 'free', tier: 'free' },
      { provider: 'vision', model: 'paid-low', tier: 'paid-low' },
      { provider: 'vision', model: 'paid-quality', tier: 'paid-quality' },
    ],
  })
  return { ctx, adapter }
}

describe('automatic image fallback routing', () => {
  it('uses the free route first and emits text-only content', async () => {
    const { ctx, adapter } = await harness(() => 'success')
    const result = await ctx.imageFallback.translate(imageContent, SessionId('image-session'))

    expect(adapter.calls).toEqual(['free'])
    expect(result.attribution).toMatchObject({ provider: 'vision', model: 'free' })
    expect(result.content.every(block => block.type === 'text')).toBe(true)
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('visible text') }),
    ]))
    await ctx.fiber.dispose()
  })

  it('advances from a transient free-route failure to paid-low and cools down the failed route', async () => {
    const { ctx, adapter } = await harness(model => model === 'free' ? 'RATE_LIMIT' : 'success')

    const first = await ctx.imageFallback.translate(imageContent, SessionId('image-session'))
    const second = await ctx.imageFallback.translate(imageContent, SessionId('image-session'))

    expect(first.attribution.model).toBe('paid-low')
    expect(second.attribution.model).toBe('paid-low')
    expect(adapter.calls).toEqual(['free', 'paid-low', 'paid-low'])
    await ctx.fiber.dispose()
  })

  it('does not advance to a paid route after an authentication failure', async () => {
    const { ctx, adapter } = await harness(model => model === 'free' ? 'AUTH' : 'success')

    await expect(ctx.imageFallback.translate(imageContent, SessionId('image-session')))
      .rejects.toMatchObject({ code: 'FAILED' } satisfies Partial<ImageFallbackError>)
    expect(adapter.calls).toEqual(['free'])
    await ctx.fiber.dispose()
  })

  it('registers ping_image_fallback and probes only the free route by default', async () => {
    const { ctx, adapter } = await harness(() => 'success')

    expect(ctx.tools.get('ping_image_fallback')).toBeDefined()
    const result = await ctx.imageFallback.probe(false, undefined, SessionId('image-session'))

    expect(adapter.calls).toEqual(['free'])
    expect(result.routes).toEqual([
      { provider: 'vision', model: 'free', tier: 'free', status: 'available' },
      { provider: 'vision', model: 'paid-low', tier: 'paid-low', status: 'not-probed' },
      { provider: 'vision', model: 'paid-quality', tier: 'paid-quality', status: 'not-probed' },
    ])
    await ctx.fiber.dispose()
  })
})
