/** Host registration for the product locale preference and model context. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  FALLBACK_LOCALE, LOCALE_SETTINGS_NAMESPACE, type LocaleId, LocaleSettingsSchema,
} from './locale-settings.ts'

export {
  FALLBACK_LOCALE, LOCALE_IDS, LOCALE_PREFERENCE_FIELD, LOCALE_SETTINGS_NAMESPACE,
  type LocaleId, type LocaleSettings,
} from './locale-settings.ts'

/** Stable model guidance for one supported product locale. */
const MODEL_LOCALE_CONTEXT: Record<LocaleId, string> = {
  zh: 'User language preference: Simplified Chinese (BCP 47: zh-Hans). '
    + 'Use Simplified Chinese by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. '
    + 'An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. '
    + 'Preserve existing content\'s language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. '
    + 'When generating HTML in this preferred language, set the document language to "zh-Hans".',
  en: 'User language preference: English (BCP 47: en). '
    + 'Use English by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. '
    + 'An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. '
    + 'Preserve existing content\'s language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. '
    + 'When generating HTML in this preferred language, set the document language to "en".',
}

/**
 * Register the durable locale section and its model context when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const locale = settingsCtx.settings.register(
      settingsNamespace(LOCALE_SETTINGS_NAMESPACE),
      LocaleSettingsSchema,
    )
    settingsCtx.inject(['systemPrompt'], (promptCtx) => promptCtx.systemPrompt.context({
      name: 'user:locale',
      order: 10,
      text: () => MODEL_LOCALE_CONTEXT[locale.get().preference ?? FALLBACK_LOCALE],
    }))
  })
}
