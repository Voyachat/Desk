/**
 * Web session model-directory and selection behavior: dynamic provider grouping,
 * provider-local catalog failures, logged-selection restoration without stale
 * catalog injection, advisory pass-through models, and the prompt-assembly
 * boundary for a running selection change.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import type { ImageAttachmentRef } from '@voyaseek-ai/dsh-attachment'
import AgentRegistry, { agentEvents } from '@voyaseek-ai/dsh-agent'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@voyaseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmCallConfig, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo,
  LlmResolvedModelInfo, StreamChunk,
  UserMessage,
} from '@voyaseek-ai/dsh-llm'
import SessionStore from '@voyaseek-ai/dsh-session'
import type { SessionId } from '@voyaseek-ai/dsh-session'
import ImageFallbackService from '@voyaseek-ai/dsh-image-fallback'
import SystemPrompt from '@voyaseek-ai/dsh-system-prompt'
import ToolRuntime from '@voyaseek-ai/dsh-tools'
import UserQuestionService from '@voyaseek-ai/dsh-user-questions'
import type { RpcRequest } from '@voyaseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@voyaseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`models-${String(nextRpc++)}`), payload }
}

class CatalogAdapter extends LlmAdapter {
  constructor(
    private readonly name: string,
    private readonly models: readonly LlmModelInfo[] | Error,
    private readonly reasoning?: LlmModelReasoningInfo,
    private readonly exactError?: Error,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.name }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return this.models instanceof Error
      ? Promise.reject(this.models)
      : Promise.resolve(this.models)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    if (this.exactError !== undefined) return Promise.reject(this.exactError)
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Catalog tests never enter provider streaming.
  }
}

const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: ReasoningEffortId('off'), name: 'Off' },
    { id: ReasoningEffortId('high'), name: 'High' },
    { id: ReasoningEffortId('max'), name: 'Max' },
  ],
  defaultEffort: ReasoningEffortId('high'),
}

async function harness(logged?: {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
}): Promise<{
  ctx: Context
  agent: Agent
  sessionId: SessionId
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', [
    { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { provider: 'deepseek-official', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', description: 'Reasoning model' },
  ], REASONING))
  ctx.llm.registerAdapter(['broken'], new CatalogAdapter('Broken Provider', new Error('catalog offline')))
  ctx.llm.registerAdapter(['metadata-broken'], new CatalogAdapter('Metadata Broken', [
    { provider: 'metadata-broken', id: 'listed', name: 'Listed' },
  ], undefined, new Error('reasoning metadata offline')))
  ctx.llm.registerAdapter(['empty'], new CatalogAdapter('Empty Provider', []))
  ctx.llm.registerAdapter(['duplicate'], new CatalogAdapter('Duplicate Provider', [
    { provider: 'duplicate', id: 'same', name: 'Same' },
    { provider: 'duplicate', id: 'same', name: 'Same Again' },
  ]))
  const session = ctx.sessions.create()
  if (logged !== undefined) {
    session.append('request/header', { header: { config: logged }, reason: 'initial' })
  }
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

function expectValue<T>(response: { result: { ok: true; value: T } | { ok: false } }): T {
  if (!response.result.ok) throw new Error('expected successful response')
  return response.result.value
}

function registerTextOnly(ctx: Context): void {
  ctx.llm.registerAdapter(['text-only'], new class extends CatalogAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
    }
  }('Text Only', []))
}

function providePromptImages(ctx: Context): void {
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 4,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 4,
      maxImagePixels: 4,
      mediaTypes: ['image/png'],
    },
    validateImage: () => Promise.resolve(),
    saveImage: (input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
      attachmentId: 'att-fallback',
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    }),
    readImage: (ref: ImageAttachmentRef) => Promise.resolve({ ref, data: Uint8Array.of(1) }),
  } as never)
}

describe('Web session model selection', () => {
  it('converts image prompts locally before a text-only model receives them', async () => {
    const { ctx, agent, sessionId } = await harness({ provider: 'text-only', model: 'plain' })
    registerTextOnly(ctx)
    providePromptImages(ctx)
    const convert = vi.fn(() => Promise.resolve({
      provider: 'mac-ocr-local',
      engine: 'mac-ocr@1.1.1',
      documents: [{ name: 'receipt.png', markdown: '| Item | Price |\n| --- | --- |\n| Tea | 8 |' }],
    }))
    ctx.provide('documentConverter', { convert } as never)
    await ctx.plugin(ImageFallbackService, { local: true, maxTokens: 512 })
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'text-only', model: 'plain' }),
      imageFallback: ctx.imageFallback,
      cwd: '/tmp',
    })

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'receipt.png' }],
    }))

    expect(response.result.ok).toBe(true)
    expect(convert).toHaveBeenCalledWith([expect.objectContaining({
      name: 'receipt.png', mediaType: 'image/png', data: Uint8Array.of(1),
    })], undefined)
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content).toEqual([
      { type: 'text', text: '[Image 1: receipt.png]' },
      {
        type: 'text',
        text: '\n\n<image-analysis source="local-document-ocr">\n## Image 1 (receipt.png)\n\n| Item | Price |\n| --- | --- |\n| Tea | 8 |\n</image-analysis>',
      },
    ])
    expect(message.source).toMatchObject({
      imageFallback: { provider: 'mac-ocr-local', model: 'mac-ocr@1.1.1' },
      displayContent: [{ type: 'image', attachment: { name: 'receipt.png' } }],
    })
    await ctx.fiber.dispose()
  })

  it('validates an ordered image batch before persisting any member', async () => {
    const { ctx, agent, sessionId } = await harness()
    const validateImage = vi.fn((_input: { data: Uint8Array }) => Promise.resolve())
    const saveImage = vi.fn((input: { data: Uint8Array; mediaType: 'image/png'; name?: string }) => Promise.resolve({
      attachmentId: `att-${String(input.data[0])}`,
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    }))
    ctx.provide('attachments', {
      imageLimits: {
        maxImageBytes: 4,
        maxImagesPerMessage: 2,
        maxMessageImageBytes: 4,
        maxImagePixels: 4,
        mediaTypes: ['image/png'],
      },
      validateImage,
      saveImage,
    } as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'first.png' },
        { type: 'text' as const, text: 'compare' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'Ag==' },
      ],
    }))
    expect(result.result.ok).toBe(true)
    expect(validateImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect(saveImage.mock.calls.map(([input]) => [...input.data])).toEqual([[1], [2]])
    expect((followup.mock.calls[0]?.[0] as UserMessage).content).toEqual([
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-1', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'first.png',
        },
      },
      { type: 'text', text: 'compare' },
      { type: 'image', attachment: { attachmentId: 'att-2', mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ])

    const denied = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: Array.from({ length: 3 }, () => ({
        type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==',
      })),
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_IMAGES' } },
    })
    expect(saveImage).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('translates image prompts through the configured vision route for a text-only model', async () => {
    const { ctx, agent, sessionId } = await harness({ provider: 'text-only', model: 'plain' })
    registerTextOnly(ctx)
    providePromptImages(ctx)
    const requests: GenerateOptions[] = []
    ctx.llm.registerAdapter(['vision'], new class extends CatalogAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
      }

      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Image 1\nA settings dialog with an error banner.' } }
        yield { type: 'usage', usage: { inputTokens: 21, outputTokens: 9 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }('Vision', []))
    const followup = vi.fn()
    Object.assign(agent, { followup })
    await ctx.plugin(ImageFallbackService, {
      local: false,
      routes: [{ provider: 'vision', model: 'eyes', tier: 'free' }],
      maxTokens: 512,
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'text-only', model: 'plain' }),
      imageFallback: ctx.imageFallback,
      cwd: '/tmp',
    })

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text' as const, text: 'How can I fix this?' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==', name: 'dialog.png' },
      ],
    }))

    expect(response.result.ok).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ provider: 'vision', model: 'eyes', maxTokens: 512, sessionId })
    expect(requests[0]?.messages[0]?.content).toEqual([
      { type: 'text', text: 'How can I fix this?' },
      { type: 'text', text: '\n[Image 1 (dialog.png)]\n' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'att-fallback', mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: 'dialog.png',
        },
      },
    ])
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content).toEqual([
      { type: 'text', text: 'How can I fix this?' },
      { type: 'text', text: '[Image 1: dialog.png]' },
      {
        type: 'text',
        text: '\n\n<image-analysis source="auxiliary-vision-model">\nImage 1\nA settings dialog with an error banner.\n</image-analysis>',
      },
    ])
    expect(message.content.some(block => block.type === 'image')).toBe(false)
    expect(message.source).toMatchObject({
      kind: 'user',
      imageFallback: {
        provider: 'vision', model: 'eyes', usage: { inputTokens: 21, outputTokens: 9 },
      },
      displayContent: [
        { type: 'text', text: 'How can I fix this?' },
        { type: 'image', attachment: { attachmentId: 'att-fallback', name: 'dialog.png' } },
      ],
    })
    await ctx.fiber.dispose()
  })

  it('does not admit an image prompt when configured fallback analysis is incomplete', async () => {
    const { ctx, agent, sessionId } = await harness({ provider: 'text-only', model: 'plain' })
    registerTextOnly(ctx)
    providePromptImages(ctx)
    ctx.llm.registerAdapter(['vision'], new class extends CatalogAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
      }

      override async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: 'partial' }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      }
    }('Vision', []))
    const followup = vi.fn()
    Object.assign(agent, { followup })
    await ctx.plugin(ImageFallbackService, {
      local: false,
      routes: [{ provider: 'vision', model: 'eyes', tier: 'free' }],
      maxTokens: 8,
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'text-only', model: 'plain' }),
      imageFallback: ctx.imageFallback,
      cwd: '/tmp',
    })

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' }],
    }))

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'IMAGE_FALLBACK_FAILED' } },
    })
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('reports configured fallback transport failures as image admission failures', async () => {
    const { ctx, agent, sessionId } = await harness({ provider: 'text-only', model: 'plain' })
    registerTextOnly(ctx)
    providePromptImages(ctx)
    ctx.llm.registerAdapter(['vision'], new class extends CatalogAdapter {
      override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
        return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
      }

      override stream(): AsyncIterable<StreamChunk> {
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new Error('provider response must not reach the client')),
          }),
        }
      }
    }('Vision', []))
    const followup = vi.fn()
    Object.assign(agent, { followup })
    await ctx.plugin(ImageFallbackService, {
      local: false,
      routes: [{ provider: 'vision', model: 'eyes', tier: 'free' }],
      maxTokens: 8,
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'text-only', model: 'plain' }),
      imageFallback: ctx.imageFallback,
      cwd: '/tmp',
    })

    const response = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' }],
    }))

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'IMAGE_FALLBACK_FAILED' } },
    })
    expect(JSON.stringify(response)).not.toContain('provider response')
    expect(followup).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('refuses a text-only selection while durable or pending image content remains visible', async () => {
    const { ctx, agent, sessionId } = await harness()
    registerTextOnly(ctx)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    const image = {
      type: 'image' as const,
      attachment: { attachmentId: 'att-history', mediaType: 'image/png' as const, bytes: 1, width: 1, height: 1 },
    }
    agent.session.append('user/message', {
      id: 'image-message', role: 'user', source: { kind: 'user' }, content: [image],
    } as never, { surfaceOp: 'append' })
    expect((await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })

    agent.session.append('user/message', {
      id: 'summary', role: 'user', source: { kind: 'plugin', plugin: 'compact' },
      content: [{ type: 'text', text: 'image summarized' }],
    } as never, {
      surfaceOp: { op: 'replace', start: 0, end: agent.session.events.length - 1 },
      sourceEventSeqs: agent.session.events.map(event => event.seq),
    })
    ;(agent.inbox.nextTurn as UserMessage[]).push({
      id: 'pending-image', role: 'user', source: { kind: 'user' }, content: [image],
    } as never)
    expect((await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).result.ok).toBe(false)
    ;(agent.inbox.nextTurn as UserMessage[]).length = 0
    expect(expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'text-only', model: 'plain',
    }))).selected).toEqual({ provider: 'text-only', model: 'plain' })
    await ctx.fiber.dispose()
  })

  it('authorizes attachment bytes only when the session event stream references the id', async () => {
    const { ctx, agent, sessionId } = await harness()
    const ref = {
      attachmentId: 'att-authorized', mediaType: 'image/png' as const, bytes: 2, width: 1, height: 1,
    }
    const readImage = vi.fn(() => Promise.resolve({ ref, data: Uint8Array.of(1, 2) }))
    ctx.provide('attachments', { readImage } as never)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })
    agent.session.append('agent/inbox/spliced', {
      target: 'next-turn',
      start: 0,
      inserted: [{
        id: 'queued-image', role: 'user',
        source: { kind: 'user', displayContent: [{ type: 'image', attachment: ref }] },
        content: [{ type: 'text', text: 'fallback description' }],
      }],
    } as never)

    const allowed = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-authorized' as never,
    }))
    expect(allowed.result).toMatchObject({ ok: true, value: { attachment: ref, data: 'AQI=' } })
    const denied = await api.sessions.attachment(request({
      sessionId, attachmentId: 'att-other' as never,
    }))
    expect(denied.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } },
    })
    expect(readImage).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })
  it('groups successful providers and leaves an unlisted current selection out of the catalog', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: ReasoningEffortId('max'),
    })
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.current).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    expect(catalog.groups).toEqual([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: REASONING },
        {
          id: 'deepseek-reasoner',
          name: 'DeepSeek Reasoner',
          description: 'Reasoning model',
          reasoning: REASONING,
        },
      ],
    }])
    expect(catalog.failures).toEqual([
      { id: 'broken', name: 'Broken Provider', message: 'catalog offline' },
      { id: 'metadata-broken', name: 'Metadata Broken', message: 'reasoning metadata offline' },
      {
        id: 'duplicate',
        name: 'Duplicate Provider',
        message: 'adapter returned invalid or duplicate model metadata for provider "duplicate"',
      },
    ])
    await ctx.fiber.dispose()
  })

  it('filters and defaults the model catalog to an alternative runtime protocol subset', async () => {
    const { ctx, agent, sessionId } = await harness()
    Object.assign(agent, {
      modelConstraint: {
        provider: 'deepseek-official',
        defaultModel: 'deepseek-reasoner',
        models: ['deepseek-reasoner'],
      },
    })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'broken', model: 'unusable-global-default' }),
      cwd: '/tmp',
    })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.current).toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    expect(catalog.groups).toEqual([{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        description: 'Reasoning model',
        reasoning: REASONING,
      }],
    }])
    expect(catalog.failures).toEqual([])
    expect((await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    }))).result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })
    expect((await api.sessions.selectModel(request({
      sessionId, provider: 'broken', model: 'unusable-global-default',
    }))).result).toMatchObject({ ok: false, error: { code: 'model-unavailable' } })
    await ctx.fiber.dispose()
  })

  it('accepts an advisory-unlisted model, rejects an unavailable provider, and switches only after the next assembly', async () => {
    const { ctx, agent, sessionId } = await harness()
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }), cwd: '/tmp' })
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    const selected = expectValue(await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })))
    expect(selected.selected).toEqual({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({ provider: 'deepseek-official', model: 'deepseek-chat' })

    expect((await ctx.systemPrompt.assemble()).variables)
      .toMatchObject({ provider: 'deepseek-official', model: 'private-preview' })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(seed),
    )).resolves.toMatchObject({
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'max',
    })

    const unsupported = await api.sessions.selectModel(request({
      sessionId,
      provider: 'deepseek-official',
      model: 'private-preview',
      reasoningEffort: 'medium',
    }))
    expect(unsupported.result).toMatchObject({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'provider "deepseek-official" model "private-preview" does not support reasoning effort "medium"',
      },
    })

    const rejected = await api.sessions.selectModel(request({
      sessionId,
      provider: 'missing',
      model: 'model',
    }))
    expect(rejected.result).toEqual({
      ok: false,
      error: {
        code: 'model-unavailable',
        message: 'no adapter registered for provider "missing"',
        details: { provider: 'missing', model: 'model' },
      },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'private-preview', reasoningEffort: 'max' })
    await ctx.fiber.dispose()
  })

  it('reads the Agent default live for a session whose log names no selection', async () => {
    const { ctx, sessionId } = await harness()
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    // The default moving after the session exists still reaches it: New
    // Session reuses a blank session rather than minting another, so a seed
    // captured at creation would show the superseded model there.
    stored = { provider: 'deepseek-official', model: 'deepseek-reasoner' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    expect(expectValue(await api.host.describe(request({}))))
      .toMatchObject({ provider: 'deepseek-official', model: 'deepseek-reasoner' })
    await ctx.fiber.dispose()
  })

  it('keeps a session on its logged selection when the Agent default differs', async () => {
    const { ctx, sessionId } = await harness({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
    let stored = { provider: 'deepseek-official', model: 'deepseek-chat' }
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => stored,
      cwd: '/tmp',
    })

    stored = { provider: 'duplicate', model: 'same' }
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat' })
    await ctx.fiber.dispose()
  })

  it('saves an accepted selection as the default and survives a storage failure', async () => {
    const { ctx, sessionId } = await harness()
    const saved: unknown[] = []
    let reject = false
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      saveDefaultModelSelection: (selection) => {
        saved.push(selection)
        return reject ? Promise.reject(new Error('read-only document')) : Promise.resolve()
      },
      cwd: '/tmp',
    })

    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max',
    })))
    expect(saved).toEqual([
      { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'max' },
    ])

    // A refused selection never becomes anyone's default.
    await api.sessions.selectModel(request({ sessionId, provider: 'missing', model: 'model' }))
    expect(saved).toHaveLength(1)

    // Storage failing is not the selection failing: the switch already applies
    // to this session, so the call still succeeds.
    reject = true
    const stillAccepted = expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'deepseek-chat',
    })))
    expect(stillAccepted.selected).toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).current)
      .toEqual({ provider: 'deepseek-official', model: 'deepseek-chat', reasoningEffort: 'high' })
    await ctx.fiber.dispose()
  })

  it('refuses a prompt no adapter can route, and reports it on the directory', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    // The client disabling its input is an affordance; this method stays
    // callable, so the refusal has to live here.
    const refused = await api.sessions.prompt(request({
      sessionId, mode: 'queue' as const, content: [{ type: 'text' as const, text: 'hi' }],
    }))
    expect(refused.result).toMatchObject({
      ok: false,
      error: { code: 'model-unavailable', details: { provider: 'deleted-gateway', model: 'deleted-model' } },
    })
    expect(expectValue(await api.sessions.models(request({ sessionId }))).routable).toBe(false)

    // An advisory-unlisted model on a live route is NOT this: the route
    // serves it, so the prompt goes through and nothing blocks.
    expectValue(await api.sessions.selectModel(request({
      sessionId, provider: 'deepseek-official', model: 'unlisted-but-served',
    })))
    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    expect(catalog.routable).toBe(true)
    expect(catalog.groups.flatMap(group => group.models.map(model => model.id)))
      .not.toContain('unlisted-but-served')
    await ctx.fiber.dispose()
  })

  it('serves a session and its catalog when the stored default names a route that is gone', async () => {
    const { ctx, sessionId } = await harness()
    const api = createApiProxy(ctx, {
      // What a Models-page removal leaves behind: the settings document still
      // names the route the user last picked, and nothing serves it.
      defaultModelSelection: () => ({ provider: 'deleted-gateway', model: 'deleted-model' }),
      cwd: '/tmp',
    })

    const catalog = expectValue(await api.sessions.models(request({ sessionId })))
    // Passed through rather than repaired: matching no group is precisely what
    // makes the composer seat prompt for a selection instead of naming a model
    // the deployment cannot reach.
    expect(catalog.current).toEqual({ provider: 'deleted-gateway', model: 'deleted-model' })
    expect(catalog.groups.flatMap(group => group.models.map(model => `${group.id}/${model.id}`)))
      .not.toContain('deleted-gateway/deleted-model')
    await ctx.fiber.dispose()
  })
})
