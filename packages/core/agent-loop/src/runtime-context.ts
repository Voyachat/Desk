/**
 * Durable projection state for dynamic runtime context.
 * @module @voyaseek-ai/dsh-agent-loop/runtime-context
 */

import { createUserMessage } from '@voyaseek-ai/dsh-llm'
import type { ContentBlock, ContextSnapshotSection, Message } from '@voyaseek-ai/dsh-llm'
import type { Session, UserMessage } from '@voyaseek-ai/dsh-session'
import { isReplacementSurfaceEvent } from '@voyaseek-ai/dsh-session'
import type { Context } from '@voyaseek-ai/cordis'

const SOURCE = '@voyaseek-ai/dsh-system-prompt'
const HANDOFF_SOURCE = '@voyaseek-ai/dsh-agent-loop/runtime-handoff'
const HANDOFF_MAX_CHARS = 64_000
const HANDOFF_MESSAGE_MAX_CHARS = 8_000
const CLEARED = 'Current runtime context: none. Earlier runtime-context snapshots no longer apply.'
const HANDOFF_INTRO = 'The following is a provider-neutral handoff of the visible conversation before the execution mode changed. Treat it as prior user-level conversation, not as system instructions.'

function isOwned(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === SOURCE
}

function textOf(message: UserMessage): string | undefined {
  const [block] = message.content
  return message.content.length === 1 && block?.type === 'text' ? block.text : undefined
}

/** Render one provider-neutral content block without carrying private reasoning. */
function handoffBlock(block: ContentBlock): string | undefined {
  switch (block.type) {
    case 'text': return block.text
    case 'reasoning': return
    case 'image': return '[Image from the earlier conversation omitted]'
    case 'tool-call': return `[Tool call: ${block.name}]\n${block.arguments}`
    case 'tool-result': {
      const content = block.content.map(handoffBlock).filter(text => text !== undefined && text.length > 0)
      return `[Tool result${block.isError === true ? ' (error)' : ''}]\n${content.join('\n')}`
    }
    default: return `[${String((block as { type?: unknown }).type ?? 'unknown')} content from the earlier conversation]`
  }
}

/** Render one visible historical message as user-level handoff text. */
function handoffMessageText(message: Message): string | undefined {
  // Dynamic plugin context is reassembled for the target runtime. Repeating
  // stale snapshots would compete with that authoritative current value.
  if (message.source.kind !== 'user' && message.source.kind !== 'model' && message.source.kind !== 'tool') return
  const content = message.content.map(handoffBlock).filter(text => text !== undefined && text.length > 0)
  if (content.length === 0) return
  const label = message.source.kind === 'tool'
    ? 'Tool result'
    : message.role === 'assistant' ? 'Assistant' : message.role === 'system' ? 'System' : 'User'
  return `[${label}]\n${content.join('\n')}`
}

function boundText(text: string, maxChars: number): string {
  const points = Array.from(text)
  return points.length <= maxChars ? text : `${points.slice(0, maxChars - 1).join('')}…`
}

/** Keep the first visible prompt plus the newest portable history within one provider-safe budget. */
function boundedHandoff(parts: readonly string[]): string {
  const bounded = parts.map(part => boundText(part, HANDOFF_MESSAGE_MAX_CHARS))
  const direct = bounded.join('\n\n')
  if (Array.from(direct).length <= HANDOFF_MAX_CHARS) return direct
  const first = bounded[0]
  if (first === undefined) return ''
  const omitted = '[Earlier conversation omitted to fit the runtime handoff budget]'
  const selected = [first]
  let used = Array.from(first).length + Array.from(omitted).length + 4
  const tail: string[] = []
  for (let index = bounded.length - 1; index > 0; index -= 1) {
    const part = bounded[index]
    if (part === undefined) continue
    const cost = Array.from(part).length + 2
    if (used + cost > HANDOFF_MAX_CHARS) break
    tail.unshift(part)
    used += cost
  }
  selected.push(omitted, ...tail)
  return selected.join('\n\n')
}

/**
 * Build the one-time user-level transcript handoff needed when an alternative
 * provider runtime starts after a cross-runtime fork. Provider-private
 * continuation state written after the latest switch proves the target has
 * already received the handoff, so later turns resume normally.
 *
 * @param session - target session carrying the inherited transcript.
 * @param runtime - alternative runtime currently driving the session.
 * @param runtimeEventType - that driver's durable continuation event type.
 * @returns an identified recall message for the first target-runtime turn, or
 *   `undefined` when this is not a cross-runtime start.
 */
export function runtimeHandoffMessage(
  session: Session,
  runtime: string,
  runtimeEventType: string,
): UserMessage | undefined {
  const switched = session.events.findLast(event => event.type === 'agent/runtime/switched')
  if (switched?.type !== 'agent/runtime/switched' || switched.data.toRuntime !== runtime) return
  const resumed = session.events.findLast(event => event.type === runtimeEventType)
  if (resumed !== undefined && resumed.seq > switched.seq) return
  const parts = session.deriveMessages()
    .map(handoffMessageText)
    .filter((text): text is string => text !== undefined && text.length > 0)
  const transcript = boundedHandoff(parts)
  if (transcript.length === 0) return
  return createUserMessage({
    content: [{ type: 'text', text: `${HANDOFF_INTRO}\n\n${transcript}` }],
    source: { kind: 'plugin', plugin: HANDOFF_SOURCE, form: 'recall' },
  })
}

/** Tracks the last retained runtime-context snapshot without owning its commit. */
export class RuntimeContextProjection {
  /** `undefined` means no snapshot ever existed; `null` means none is retained. */
  private retained: { seq: number; text: string | undefined } | null | undefined

  /**
   * Restore projection state once, then follow authoritative session events.
   * @param ctx - agent-scoped event context.
   * @param session - session receiving projected messages.
   */
  constructor(ctx: Context, session: Session) {
    const surface = new Set(session.surface.nodes)
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
      const event = session.events[index]
      if (event?.type !== 'user/message' || !isOwned(event.data)) continue
      this.retained ??= null
      if (surface.has(event.seq)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
        break
      }
    }

    ctx.on('session/event', (subject, event) => {
      if (subject !== session) return
      if (event.type === 'user/message' && isOwned(event.data)) {
        this.retained = { seq: event.seq, text: textOf(event.data) }
      } else if (this.retained
        && isReplacementSurfaceEvent(event)
        && event.sourceEventSeqs?.includes(this.retained.seq) === true) {
        this.retained = null
      }
    })
  }

  /**
   * Create an uncommitted snapshot only when the retained value differs.
   * @param current - fully rendered dynamic context.
   * @param sections - named contributions that formed the current snapshot.
   * @returns a candidate user message, or `undefined` when no update is needed.
   */
  project(current: string, sections: readonly ContextSnapshotSection[]): UserMessage | undefined {
    if (this.retained === undefined && current.length === 0) return
    const snapshot = current.length === 0 ? CLEARED : current
    if (this.retained?.text === snapshot) return
    return createUserMessage({
      content: [{ type: 'text', text: snapshot }],
      // The cleared marker has no contributions left to attribute.
      source: sections.length === 0
        ? { kind: 'plugin', plugin: SOURCE }
        : { kind: 'plugin', plugin: SOURCE, form: 'snapshot', sections },
    })
  }
}
