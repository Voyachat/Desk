/**
 * Bounded recovery for provider `stop` responses that promise an immediate
 * action without issuing the corresponding tool call.
 * @module @voyaseek-ai/dsh-premature-stop-recovery
 */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import type { Agent } from '@voyaseek-ai/dsh-agent'
import { createUserMessage } from '@voyaseek-ai/dsh-llm'
import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import { looksLikePrematureStop } from './detector.ts'

export const name = 'premature-stop-recovery'
export const inject = ['agents']

/** Premature-stop recovery configuration. */
export interface Config {
  /** Maximum continuation prompts without an intervening tool result. */
  maxContinuations?: number
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  maxContinuations: z.number().step(1).min(1).default(3),
})

const CONTINUE_PROMPT = 'Continue the unfinished task now. The previous response announced an immediate action but '
  + 'did not perform it. Take the next concrete action with the available tools. Do not narrate, plan, or promise '
  + 'another action without executing it. Continue toward the requested deliverable until it is complete. If the '
  + 'task is actually complete or cannot safely continue, state the result or blocker explicitly instead.'

const EXHAUSTED_PROMPT = 'Automatic continuation made no concrete progress after repeated attempts. Do not promise '
  + 'another action in this step. Tell the user plainly that the task remains incomplete, name the last concrete '
  + 'result or blocker, and state the exact next action needed to resume.'

interface RecoveryState {
  readonly turn: number
  continuations: number
  finalizing: boolean
  resultCount: number
}

/** Count successful tool calls in the open turn as durable concrete progress. */
function toolResultCount(agent: Agent, turn: number): number {
  const events = agent.session.events
  let count = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) break
    if (event?.type === 'tool/result'
      && event.data.turn === turn
      && event.data.message.content.every(block => block.isError === false)) count += 1
  }
  return count
}

/** Return the last default-loop provider-stop text for the open turn. */
function stoppedText(agent: Agent, turn: number): string | undefined {
  const events = agent.session.events
  const messageEvent = events.findLast((event): event is SessionEvent<'assistant/message'> =>
    event.type === 'assistant/message' && event.data.turn === turn)
  if (messageEvent === undefined) return undefined
  if (messageEvent.data.message.content.some(block => block.type === 'tool-call')) return undefined
  const { step } = messageEvent.data
  const finishEvent = events.findLast((event): event is SessionEvent<'assistant/chunk'> =>
    event.type === 'assistant/chunk'
      && event.data.turn === turn
      && event.data.step === step
      && event.data.chunk.type === 'finish')
  if (finishEvent?.data.chunk.type !== 'finish' || finishEvent.data.chunk.reason.kind !== 'stop') return undefined
  const text = messageEvent.data.message.content
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('\n')
  return text.length === 0 ? undefined : text
}

/**
 * Install bounded same-turn recovery at the documented stop extension point.
 * @param ctx - plugin context that owns the listener.
 * @param config - validated recovery limit.
 */
export function apply(ctx: Context, config: Config): void {
  const maxContinuations = config.maxContinuations as number
  const states = new WeakMap<Agent, RecoveryState>()

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    const text = stoppedText(agent, turn)
    if (text === undefined || !looksLikePrematureStop(text)) return

    const resultCount = toolResultCount(agent, turn)
    let state = states.get(agent)
    if (state?.turn !== turn) {
      state = { turn, continuations: 0, finalizing: false, resultCount }
      states.set(agent, state)
    } else if (resultCount > state.resultCount) {
      state.continuations = 0
      state.finalizing = false
      state.resultCount = resultCount
    }
    if (state.continuations < maxContinuations) {
      state.continuations += 1
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: CONTINUE_PROMPT }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'notice',
          summary: `Automatic continuation ${state.continuations}/${maxContinuations}`,
        },
      }))
      return
    }
    if (!state.finalizing) {
      state.finalizing = true
      agent.steer(createUserMessage({
        content: [{ type: 'text', text: EXHAUSTED_PROMPT }],
        source: {
          kind: 'plugin',
          plugin: name,
          form: 'notice',
          summary: `Recovery limit reached (${maxContinuations})`,
        },
      }))
      return
    }
    ctx.logger.warn(`premature-stop-recovery: agent "${agent.id}" turn ${turn} stopped again after the failure report`)
  })
}
