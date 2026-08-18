/**
 * Model-facing texts of the language policy. The section states the standing
 * default output language; the context carries the per-conversation delta
 * (detected input language and persisted explicit rules). Both are pinned by
 * tests because they are the product's language contract with the model.
 * @module @voyaseek-ai/dsh-aistaff-language-policy/prompt-text
 */

import { languageName } from './detect.ts'

/**
 * The stable system-prompt section naming the default output language.
 * @param defaultTag - configured or product-default language tag.
 * @returns the standing directive covering replies and every deliverable kind.
 */
export function renderLanguageSection(defaultTag: string): string {
  const name = languageName(defaultTag)
  return `Default output language: ${name} (${defaultTag}). `
    + `Use ${name} for all assistant replies and for all user-facing content in every deliverable the work produces — `
    + 'web pages, applications, spreadsheets and tables, documents, presentations, image text, audio, and video (including subtitles and on-screen text) — '
    + 'unless the runtime context states an active language policy or the current user request explicitly asks for another language. '
    + 'Preserve the existing language of files being edited unless translation is requested; never translate code, identifiers, commands, or file paths. '
    + 'When the user explicitly asks a language for a scope (all output, this workspace, or one deliverable), record it with the language_rule tool so it persists.'
}

/** Inputs rendering the per-conversation runtime-context delta. */
export interface PolicyContextInput {
  /** Configured or product-default language tag. */
  baselineTag: string
  /** Confident language detected from recent user input, when any. */
  detectedTag?: string | undefined
  /** Rendered explicit-rules block, or `''` without applicable rules. */
  rulesBlock: string
}

/**
 * The runtime-context delta for one conversation. Empty when the baseline
 * fully describes the session, so the standing locale guidance stays the only
 * language text on the common path.
 * @param input - baseline, detection, and rules of this session.
 * @returns the override text, or `''` when nothing deviates from the baseline.
 */
export function renderPolicyContext(input: PolicyContextInput): string {
  const parts: string[] = []
  const detected = input.detectedTag
  if (detected !== undefined && detected !== input.baselineTag) {
    const name = languageName(detected)
    parts.push(`Active conversation language: ${name} (${detected}) — detected from the user's own input. `
      + `Use ${name} for your replies in this conversation and for newly created user-facing deliverable content, `
      + 'overriding the default output language above. If the user switches input language again, follow the newest detection.')
  }
  if (input.rulesBlock.length > 0) parts.push(input.rulesBlock)
  return parts.join('\n\n')
}
