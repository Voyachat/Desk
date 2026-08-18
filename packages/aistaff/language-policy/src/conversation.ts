/**
 * Per-conversation language fold over the durable session log. Replay-safe by
 * construction: the answer derives only from logged user messages, so a
 * restored session resolves the same conversation language without extra
 * state. Delegation prompts carry `source.kind === 'user'` too, so child
 * agents follow the language their parent spoke.
 * @module @voyaseek-ai/dsh-aistaff-language-policy/conversation
 */

import type { SessionEvent } from '@voyaseek-ai/dsh-session'
import { detectLanguage } from './detect.ts'

/** How many recent user messages the fold inspects before giving up. */
export const MAX_SCANNED_USER_MESSAGES = 8

/**
 * The language of the newest confident user input in one session log.
 * @param events - the session's authoritative event array, in seq order.
 * @param maxMessages - most recent user messages considered; bounded so long
 *   sessions keep the per-assembly cost constant.
 * @returns the detected tag, or `undefined` when no recent input is confident.
 */
export function conversationLanguage(
  events: readonly SessionEvent[],
  maxMessages: number = MAX_SCANNED_USER_MESSAGES,
): string | undefined {
  let scanned = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'user/message') continue
    const message = event.data
    if (message.source.kind !== 'user') continue
    scanned += 1
    if (scanned > maxMessages) return undefined
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    const detected = detectLanguage(text)
    if (detected !== undefined) return detected
  }
  return undefined
}
