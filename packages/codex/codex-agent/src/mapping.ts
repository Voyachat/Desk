/** Projection of Codex app-server transcript items into DSH session events. */

import { CallId, createAssistantMessage, createToolResultMessage } from '@voyaseek-ai/dsh-llm'
import type { ContentBlock } from '@voyaseek-ai/dsh-llm'
import type { Session } from '@voyaseek-ai/dsh-session'
import { CODEX_PROVIDER } from './constants.ts'
import type { CodexTurnSink } from './wire.ts'

type JsonObject = Record<string, unknown>

function itemId(item: JsonObject): string | undefined {
  return typeof item.id === 'string' && item.id.length > 0 ? item.id : undefined
}

function itemText(item: JsonObject): string {
  if (typeof item.text === 'string') return item.text
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput
  if (typeof item.output === 'string') return item.output
  return ''
}

function toolName(type: string): string {
  switch (type) {
    case 'commandExecution': return 'CodexCommand'
    case 'fileChange': return 'CodexFileChange'
    case 'mcpToolCall': return 'CodexMcpTool'
    default: return `Codex:${type}`
  }
}

/** Turn-scoped recorder for Codex stream deltas and completed items. */
export class CodexEventRecorder implements CodexTurnSink {
  private readonly chunks = new Map<string, number[]>()
  private readonly toolCallSeqs = new Map<string, number>()
  private fallbackItem = 0

  /** Bind the recorder to one open DSH step. */
  constructor(
    private readonly session: Session,
    private readonly turn: number,
    private readonly step: number,
    private readonly model: string,
    private readonly provider = CODEX_PROVIDER,
  ) {}

  /**
   * Record one app-server output delta.
   * @param id - item identity used to link chunks to the completed message.
   * @param phase - visible text or hidden reasoning channel.
   * @param text - exact delta bytes.
   */
  onDelta(id: string | undefined, phase: 'text' | 'reasoning', text: string): void {
    const key = id ?? `anonymous-${this.fallbackItem}`
    const index = phase === 'text' ? 0 : 1
    const event = this.session.append('assistant/chunk', {
      turn: this.turn,
      step: this.step,
      chunk: phase === 'text'
        ? { type: 'text-delta', index, text }
        : { type: 'reasoning-delta', index, text },
    })
    const seqs = this.chunks.get(key) ?? []
    seqs.push(event.seq)
    this.chunks.set(key, seqs)
  }

  /**
   * Record one completed transcript item.
   * @param item - decoded app-server item object.
   */
  onItemCompleted(item: JsonObject): void {
    const type = typeof item.type === 'string' ? item.type : ''
    const id = itemId(item)
    if (type === 'agentMessage') {
      const text = itemText(item)
      if (text.length === 0) return
      const phase = item.phase
      if (phase !== 'final_answer' && phase !== null && phase !== 'commentary') {
        throw new Error(`codex-agent: unknown agent message phase ${JSON.stringify(phase)}`)
      }
      const content: ContentBlock[] = [{
        type: phase === 'commentary' ? 'reasoning' : 'text',
        text,
      }]
      const sourceEventSeqs = id === undefined ? undefined : this.chunks.get(id)
      this.session.append('assistant/message', {
        turn: this.turn,
        step: this.step,
        message: createAssistantMessage({
          content,
          source: { provider: this.provider, model: this.model },
        }),
      }, {
        surfaceOp: 'append',
        ...sourceEventSeqs === undefined ? {} : { sourceEventSeqs },
      })
      this.fallbackItem++
      return
    }
    if (id === undefined || !['commandExecution', 'fileChange', 'mcpToolCall'].includes(type)) return
    const callId = CallId(id)
    let callSeq = this.toolCallSeqs.get(id)
    if (callSeq === undefined) {
      const event = this.session.append('tool/call', {
        turn: this.turn,
        step: this.step,
        callId,
        name: toolName(type),
        arguments: JSON.stringify(item),
      })
      callSeq = event.seq
      this.toolCallSeqs.set(id, callSeq)
    }
    const status = typeof item.status === 'string' ? item.status : 'completed'
    this.session.append('tool/result', {
      turn: this.turn,
      step: this.step,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: itemText(item) }],
        isError: status === 'failed' || status === 'declined',
      }),
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
  }
}
