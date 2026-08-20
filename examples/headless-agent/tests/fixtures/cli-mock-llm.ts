import type { Context } from '@voyaseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@voyaseek-ai/dsh-llm'

const HIGH = ReasoningEffortId('high')
const OFF = ReasoningEffortId('off')

/** Keyless headless-agent adapter: one real bash call followed by a final answer. */
class CliMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: OFF, name: 'Off' },
          { id: HIGH, name: 'High' },
        ],
        defaultEffort: HIGH,
      },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (process.env.DSH_CLI_MOCK_FAILURE === '1') {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'CLI mock provider failed' } } }
      return
    }
    if (process.env.DSH_CLI_EXPECT_AUTO_DESIGN_SKILL === '1') {
      const injectionCount = options.messages.flatMap(message => message.content).filter(block =>
        block.type === 'text' && block.text.includes('<skill_content name="design-taste-frontend">'),
      ).length
      const reply = injectionCount === 1
        ? 'AUTOMATIC_DESIGN_SKILL_INJECTED_ONCE'
        : `AUTOMATIC_DESIGN_SKILL_INJECTION_COUNT_${injectionCount}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    if (process.env.DSH_CLI_MEMORY_MODE !== undefined) {
      if (options.system?.includes('你维护用户的长期记忆') === true) {
        const extraction = JSON.stringify([{
          action: 'upsert', kind: 'preference', key: 'verification-drink', title: '验证饮料',
          content: '用户的验证饮料是 lapsang-fixture。',
          evidence: '请记住我的验证饮料是 lapsang-fixture。',
          keywords: ['验证饮料', 'drink', 'beverage'], confidence: 0.99,
        }])
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: extraction }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: extraction } }
        yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 20 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const recalled = options.messages.flatMap(message => message.content).some(block =>
        block.type === 'text'
        && block.text.includes('以下是相关长期记忆')
        && block.text.includes('lapsang-fixture'),
      )
      const reply = process.env.DSH_CLI_MEMORY_MODE === 'capture'
        ? '已记住验证饮料 lapsang-fixture。'
        : recalled
          ? 'MEMORY_RECALLED_lapsang-fixture'
          : 'MEMORY_RECALL_MISSING'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult === undefined) {
      const args = JSON.stringify({ command: 'printf CLI_TOOL_ROUND_TRIP', description: 'Prove the CLI tool round trip.' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: CallId('cli-smoke-call'), name: 'bash', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('cli-smoke-call'), name: 'bash', arguments: args } }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }

    const toolText = toolResult.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    const reply = `CLI tool round trip complete: ${toolText.trim()}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5, reasoningTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'cli-mock-llm'
export const inject = ['llm']

/** Register the keyless `cli-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['cli-mock'], new CliMockAdapter())
  ctx.on('agent/request', async ({ step }, next) => {
    const config = await next()
    return step === 2 ? { ...config, reasoningEffort: OFF } : config
  })
}
