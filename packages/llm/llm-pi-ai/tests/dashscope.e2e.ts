/**
 * Real-API e2e against Alibaba Cloud DashScope's OpenAI-compatible endpoint.
 * Self-skips without DASHSCOPE_API_KEY; the streaming case serves the model
 * DSH_PI_AI_DASHSCOPE_MODEL names (default qwen-plus). The assertions encode
 * what "DashScope works in a conversation" requires: the listing narrows to
 * agent-servable candidates, and a request carrying the system prompt and
 * tool definitions an agent conversation always sends completes instead of
 * failing on wire shapes the endpoint refuses.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@voyaseek-ai/dsh-llm'
import type { ToolSchema } from '@voyaseek-ai/dsh-llm'
import * as LlmPiAi from '@voyaseek-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'

const apiKey = process.env.DASHSCOPE_API_KEY
const baseURL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const model = process.env.DSH_PI_AI_DASHSCOPE_MODEL ?? 'qwen-plus'

// Word fragments DashScope uses for the non-chat product families an agent
// conversation cannot use; discovery must not offer them for adoption.
const NON_CHAT_FRAGMENTS = ['embedding', 'rerank', 'tts', 'asr', 'realtime', 'speech', 'livetranslate']

const readTool: ToolSchema = {
  name: 'read_file',
  description: 'Read one file from the workspace and return its contents.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: 'File path to read.' } },
    required: ['path'],
  },
}

describe.skipIf(apiKey === undefined)('llm-pi-ai dashscope e2e', () => {
  it('narrows the real listing to agent-servable candidates', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {})
    try {
      const found = await ctx.llm.discoverModels('llm-pi-ai', {
        baseURL,
        ...apiKey === undefined ? {} : { apiKey },
      })
      expect(found.length).toBeGreaterThan(0)
      for (const candidate of found) {
        const id = candidate.id.toLowerCase()
        expect(NON_CHAT_FRAGMENTS.some(fragment => id.includes(fragment)), candidate.id).toBe(false)
      }
    } finally {
      await ctx.fiber.dispose()
    }
  }, 60_000)

  it('completes a tool-carrying request through the materialized route', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        dashscope: {
          displayName: 'DashScope',
          apiKeyEnv: 'DASHSCOPE_API_KEY',
          api: 'openai-completions',
          baseURL,
          models: [{ id: model }],
        },
      },
    })
    try {
      const result = await assemble(ctx, {
        provider: 'dashscope',
        model,
        messages: [createUserMessage({
          content: [{ type: 'text', text: 'Use the read_file tool to read package.json. Do not answer in text.' }],
          source: { kind: 'plugin', plugin: 'test' },
        })],
        system: 'You are a coding agent. Use tools to accomplish the task.',
        tools: [readTool],
        maxTokens: 1024,
      })
      if (result.finish.kind === 'error') {
        throw new Error(`dashscope ${model} failed (${result.finish.failure.code}): ${result.finish.failure.message}`)
      }
      expect(['stop', 'tool-calls', 'max-tokens']).toContain(result.finish.kind)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 120_000)
})
