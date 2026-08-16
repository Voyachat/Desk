/**
 * Classification behavior for the model-family knowledge base: what an
 * OpenAI-compatible listing's non-chat models are refused, what known chat
 * families lend, and why an unknown id stays servable.
 */
import { describe, expect, it } from 'vitest'
import { classifyModel } from '../src/model-families.ts'

describe('non-chat classification', () => {
  it.each([
    ['text-embedding-v4', 'embedding'],
    ['qwen3.7-text-embedding', 'embedding'],
    ['gte-rerank-v2', 'rerank'],
    ['qwen3-tts-flash', 'speech synthesis'],
    ['MiniMax/speech-2.8-hd', 'speech synthesis'],
    ['qwen-tts-2025-05-22', 'speech synthesis'],
    ['qwen3-asr-flash-realtime-2026-02-10', 'speech recognition'],
    ['fun-asr-flash-2026-06-15', 'speech recognition'],
    ['qwen-audio-3.0-asr-flash', 'audio'],
    ['qwen-audio-3.0-realtime-flash', 'realtime'],
    ['qwen3.5-livetranslate-flash-realtime', 'realtime'],
    ['qwen3.5-omni-flash-realtime-2026-03-15', 'realtime'],
    ['wan2.7-image-pro', 'image generation'],
    ['qwen-image-3.0', 'image generation'],
    ['qwen-image-edit-max', 'image generation'],
    ['z-image-turbo', 'image generation'],
    ['test-sre-gpu-auto-handle', 'internal'],
    ['sre-gpu-auto-handle', 'internal'],
  ])('refuses %s', (id) => {
    const classification = classifyModel(id)
    expect(classification.agentServable).toBe(false)
    expect(classification.reason).toBeDefined()
  })

  it('refuses the tool-less chat models an agent request cannot use', () => {
    for (const id of ['qwen-mt-flash', 'qwen-mt-plus', 'qwen-deep-research-2025-12-15', 'qwen-deep-search-planning']) {
      expect(classifyModel(id).agentServable, id).toBe(false)
      expect(classifyModel(id).reason).toMatch(/tool calls/)
    }
  })
})

describe('chat classification', () => {
  it('keeps the plain chat families servable', () => {
    for (const id of ['qwen-plus', 'qwen-max', 'qwen-flash', 'qwen-long', 'gui-plus', 'qwen-vl-ocr', 'qwen3.5-ocr', 'qwen-math-plus', 'unknown-gateway-model']) {
      expect(classifyModel(id).agentServable, id).toBe(true)
    }
  })

  it('keeps the non-realtime omni models servable', () => {
    expect(classifyModel('qwen3-omni-flash').agentServable).toBe(true)
    expect(classifyModel('qwen-omni-turbo').agentServable).toBe(true)
  })

  it('keeps a model the knowledge base has never seen servable', () => {
    const classification = classifyModel('acme-large')
    expect(classification.agentServable).toBe(true)
    expect(classification.facts).toBeUndefined()
  })
})

describe('family knowledge lookup', () => {
  it('walks an owner prefix to the family stem', () => {
    expect(classifyModel('kimi/kimi-k2.6').facts?.contextWindow).toBe(262_144)
    expect(classifyModel('MiniMax/MiniMax-M2.5').facts?.contextWindow).toBe(196_608)
    expect(classifyModel('ZHIPU/GLM-5.2').facts?.maxTokens).toBe(131_072)
  })

  it('walks a dated snapshot suffix to the family stem', () => {
    expect(classifyModel('qwen3-max-2026-01-23').facts?.reasoningEfforts).toBeDefined()
    expect(classifyModel('qwen3.7-plus-2026-05-26').facts?.contextWindow).toBe(1_000_000)
    expect(classifyModel('deepseek-v4-pro-0813').facts?.maxTokens).toBe(384_000)
    expect(classifyModel('qwen-plus-latest').agentServable).toBe(true)
  })

  it('survives an id that reduces to nothing under suffix stripping', () => {
    expect(classifyModel('-latest').agentServable).toBe(true)
    expect(classifyModel('owner/-2025-01-01').agentServable).toBe(true)
  })

  it('lends a known reasoning family its selectable efforts', () => {
    const efforts = classifyModel('qwen3.7-flash').facts?.reasoningEfforts
    expect(efforts).toMatchObject({ off: null, low: 'low', medium: 'medium', high: 'high' })
  })

  it('lends the vision families their image modality', () => {
    expect(classifyModel('qwen3-vl-plus').facts?.input).toEqual(['text', 'image'])
    expect(classifyModel('kimi-k2.5').facts?.input).toEqual(['text', 'image'])
  })

  it('leaves a chat family without recorded capacities to the route defaults', () => {
    const classification = classifyModel('qwen-flash-character-2026-02-26')
    expect(classification.agentServable).toBe(true)
    expect(classification.facts).toBeUndefined()
  })
})
