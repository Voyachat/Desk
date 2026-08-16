/**
 * Translation of official SDK stream messages into the durable session
 * events the DSH surface renders. The SDK process remains the execution
 * authority; this recorder only projects its transcript into the log.
 * @module @deepseek-ai/dsh-claude-agent/mapping
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { CallId, createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { CLAUDE_PROVIDER } from './constants.ts'
import type {} from './types.ts'

/** One SDK content block narrowed to its transcript-relevant fields. */
interface SdkContentBlock {
  readonly type?: unknown
  readonly text?: unknown
  readonly thinking?: unknown
  readonly id?: unknown
  readonly name?: unknown
  readonly input?: unknown
  readonly tool_use_id?: unknown
  readonly content?: unknown
  readonly is_error?: unknown
}

/**
 * Extract display text from an SDK tool-result payload.
 * @param content - string payload or block array reported by the SDK.
 * @returns the concatenated text of the payload, empty when none.
 */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const texts: string[] = []
  for (const block of content as SdkContentBlock[]) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text)
    }
  }
  return texts.join('\n')
}

/**
 * Map one SDK assistant content block to its durable DSH block, or `undefined`
 * for transcript-irrelevant variants.
 * @param block - one SDK assistant content entry.
 * @returns the durable block, or `undefined` to skip.
 */
function assistantBlock(block: SdkContentBlock): ContentBlock | undefined {
  if (block === null || typeof block !== 'object') return undefined
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? { type: 'text', text: block.text } : undefined
    case 'thinking':
      return typeof block.thinking === 'string' ? { type: 'reasoning', text: block.thinking } : undefined
    case 'tool_use':
      if (typeof block.id !== 'string' || typeof block.name !== 'string') return undefined
      return {
        type: 'tool-call',
        id: CallId(block.id),
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      }
    default:
      return undefined
  }
}

/**
 * Turn-scoped recorder projecting the SDK stream into one open step. Tool
 * results link back to the seq of their recorded call so the surface fold
 * pairs them exactly like the default loop's pairs.
 */
export class SdkEventRecorder {
  private readonly callSeqs = new Map<string, number>()

  /**
   * Bind a recorder to one open step.
   * @param session - durable log receiving the projected events.
   * @param turn - open turn owning the step.
   * @param step - open step owning the recorded events.
   * @param model - model name stamped on assistant provenance.
   * @param onClaudeSession - receives the SDK conversation id when the stream reports one.
   */
  constructor(
    private readonly session: Session,
    private readonly turn: number,
    private readonly step: number,
    private readonly model: string,
    private readonly onClaudeSession?: (claudeSessionId: string, model?: string) => void,
  ) {}

  /**
   * Record one SDK stream message as durable events. Unknown and
   * control-plane messages are skipped: the DSH transcript keeps
   * conversation facts, not SDK bookkeeping.
   * @param message - one decoded SDK message.
   */
  apply(message: SDKMessage): void {
    switch (message.type) {
      case 'system': {
        const record = message as unknown as { subtype?: unknown; session_id?: unknown; model?: unknown }
        if (record.subtype !== 'init' || typeof record.session_id !== 'string') return
        this.onClaudeSession?.(record.session_id, typeof record.model === 'string' ? record.model : undefined)
        return
      }
      case 'assistant': {
        const content = (message as unknown as { message?: { content?: unknown } }).message?.content
        if (!Array.isArray(content)) return
        const blocks: ContentBlock[] = []
        for (const block of content as SdkContentBlock[]) {
          const mapped = assistantBlock(block)
          if (mapped !== undefined) blocks.push(mapped)
        }
        if (blocks.length === 0) return
        this.session.append('assistant/message', {
          turn: this.turn,
          step: this.step,
          message: createAssistantMessage({
            content: blocks,
            source: { provider: CLAUDE_PROVIDER, model: this.model },
          }),
        }, { surfaceOp: 'append' })
        for (const block of blocks) {
          if (block.type !== 'tool-call') continue
          const event = this.session.append('tool/call', {
            turn: this.turn,
            step: this.step,
            callId: block.id,
            name: block.name,
            arguments: block.arguments,
          })
          this.callSeqs.set(block.id, event.seq)
        }
        return
      }
      case 'user': {
        const content = (message as unknown as { message?: { content?: unknown } }).message?.content
        if (!Array.isArray(content)) return
        for (const block of content as SdkContentBlock[]) {
          if (block === null || typeof block !== 'object' || block.type !== 'tool_result') continue
          if (typeof block.tool_use_id !== 'string') continue
          const callId = CallId(block.tool_use_id)
          const callSeq = this.callSeqs.get(callId)
          this.session.append('tool/result', {
            turn: this.turn,
            step: this.step,
            message: createToolResultMessage({
              callId,
              content: [{ type: 'text', text: resultText(block.content) }],
              isError: block.is_error === true,
            }),
          }, {
            surfaceOp: 'append',
            ...callSeq === undefined ? {} : { sourceEventSeqs: [callSeq] },
          })
        }
        return
      }
      default:
        return
    }
  }
}
