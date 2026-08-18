/**
 * Deterministic heuristic language detection over user-authored text.
 * Script-range analysis decides CJK and other non-Latin scripts; a small
 * function-word vocabulary distinguishes Latin-script languages. Detection
 * returns `undefined` whenever no script or vocabulary is confident, so a
 * caller keeps its current language instead of switching on noise.
 * @module @voyaseek-ai/dsh-aistaff-language-policy/detect
 */

/** Fewest CJK ideographs that can carry a Chinese sentence (`好的` suffices). */
const MIN_CJK_CHARS = 2

/** Fewest Latin letters examined before vocabulary scoring. */
const MIN_LATIN_LETTERS = 3

/** Fewest non-Latin alphabetic letters required for a script verdict. */
const MIN_SCRIPT_LETTERS = 2

/**
 * Function words per Latin-script language. A detected word must appear
 * verbatim in the lowercased input, so these stay unambiguous high-frequency
 * tokens rather than stems.
 */
const LATIN_STOPWORDS: Record<string, readonly string[]> = {
  en: ['the', 'and', 'for', 'with', 'this', 'that', 'have', 'what', 'your', 'from', 'please', 'you', 'are', 'not', 'but', 'can', 'will', 'my', 'need', 'make'],
  es: ['que', 'los', 'las', 'una', 'para', 'con', 'por', 'como', 'este', 'esta', 'del', 'pero', 'sus', 'hola', 'gracias', 'necesito', 'quiero'],
  fr: ['les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'pas', 'est', 'que', 'qui', 'mais', 'bonjour', 'merci', 'je', 'veux', 'besoin'],
  de: ['und', 'der', 'die', 'das', 'eine', 'einen', 'mit', 'auf', 'den', 'nicht', 'ist', 'von', 'aber', 'hallo', 'danke', 'ich', 'bitte'],
  pt: ['que', 'uma', 'para', 'com', 'por', 'como', 'este', 'esta', 'mas', 'dos', 'das', 'olá', 'obrigado', 'preciso', 'quero'],
  it: ['che', 'per', 'con', 'una', 'sono', 'non', 'questo', 'questa', 'come', 'del', 'della', 'ciao', 'grazie', 'voglio', 'bisogno'],
  id: ['yang', 'dan', 'untuk', 'dengan', 'ini', 'itu', 'dari', 'pada', 'adalah', 'tidak', 'bisa', 'tolong', 'terima', 'kasih', 'saya', 'mau'],
  tr: ['bir', 'için', 'ile', 'olarak', 'gibi', 'ama', 'veya', 'bu', 'şu', 'merhaba', 'teşekkür', 'lütfen', 'istiyorum', 'lazım'],
  nl: ['het', 'een', 'van', 'voor', 'met', 'dat', 'die', 'niet', 'zijn', 'maar', 'hallo', 'dank', 'graag', 'ik', 'wil'],
  pl: ['nie', 'się', 'jest', 'jak', 'ale', 'czy', 'dla', 'że', 'witam', 'dziękuję', 'proszę', 'chcę', 'potrzebuję'],
  vi: ['và', 'của', 'là', 'cho', 'với', 'này', 'kia', 'không', 'được', 'một', 'những', 'xin', 'chào', 'cảm', 'ơn', 'tôi', 'muốn'],
}

/** English name per detected tag, used when rendering model-facing text. */
const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  it: 'Italian',
  ru: 'Russian',
  ar: 'Arabic',
  th: 'Thai',
  hi: 'Hindi',
  he: 'Hebrew',
  el: 'Greek',
  id: 'Indonesian',
  tr: 'Turkish',
  nl: 'Dutch',
  pl: 'Polish',
  vi: 'Vietnamese',
}

/**
 * Human-readable language name for one detected or requested tag. Regional
 * subtags resolve through their primary language (`zh-Hans` -> Simplified
 * Chinese).
 * @param tag - language tag, for example `zh`, `en`, or `zh-Hans`.
 * @returns the English display name, or the tag itself when unknown.
 */
export function languageName(tag: string): string {
  const primary = tag.toLowerCase().split('-')[0] ?? tag
  return LANGUAGE_NAMES[tag] ?? LANGUAGE_NAMES[primary] ?? tag
}

/** Per-script character tallies for one input text. */
interface ScriptCounts {
  cjk: number
  kana: number
  hangul: number
  latin: number
  cyrillic: number
  arabic: number
  thai: number
  devanagari: number
  hebrew: number
  greek: number
}

/** Tally one input's characters into script buckets. */
function countScripts(text: string): ScriptCounts {
  const counts: ScriptCounts = {
    cjk: 0, kana: 0, hangul: 0, latin: 0, cyrillic: 0,
    arabic: 0, thai: 0, devanagari: 0, hebrew: 0, greek: 0,
  }
  for (const char of text) {
    const cp = char.codePointAt(0)
    /* v8 ignore next -- iteration over a string always yields code points */
    if (cp === undefined) continue
    if (cp >= 0x3040 && cp <= 0x30FF) counts.kana += 1
    else if ((cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x1100 && cp <= 0x11FF)) counts.hangul += 1
    else if (
      (cp >= 0x4E00 && cp <= 0x9FFF)
      || (cp >= 0x3400 && cp <= 0x4DBF)
      || (cp >= 0xF900 && cp <= 0xFAFF)
      || (cp >= 0x20000 && cp <= 0x2EBEF)) counts.cjk += 1
    else if (
      (cp >= 0x0041 && cp <= 0x005A)
      || (cp >= 0x0061 && cp <= 0x007A)
      || (cp >= 0x00C0 && cp <= 0x024F)) counts.latin += 1
    else if (cp >= 0x0400 && cp <= 0x04FF) counts.cyrillic += 1
    else if (cp >= 0x0600 && cp <= 0x06FF) counts.arabic += 1
    else if (cp >= 0x0E00 && cp <= 0x0E7F) counts.thai += 1
    else if (cp >= 0x0900 && cp <= 0x097F) counts.devanagari += 1
    else if (cp >= 0x0590 && cp <= 0x05FF) counts.hebrew += 1
    else if (cp >= 0x0370 && cp <= 0x03FF) counts.greek += 1
  }
  return counts
}

/** Lowercased Latin-script words including common accented ranges. */
function latinWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z\u00C0-\u024F]+/g) ?? []
}

/**
 * The Latin-script language whose vocabulary appears most often.
 * @param words - lowercased words of the input.
 * @returns the winning tag, or `undefined` without any vocabulary hit.
 */
function classifyLatin(words: readonly string[]): string | undefined {
  let best: { tag: string; hits: number } | undefined
  for (const [tag, stopwords] of Object.entries(LATIN_STOPWORDS)) {
    const set = new Set(stopwords)
    let hits = 0
    for (const word of words) {
      if (set.has(word)) hits += 1
    }
    if (hits > 0 && (best === undefined || hits > best.hits)) best = { tag, hits }
  }
  return best?.tag
}

/**
 * Detect the dominant natural language of one user-authored text.
 * @param text - raw user text; code, paths, and markup dilute but do not break the tally.
 * @returns a language tag such as `zh` or `en`, or `undefined` when not confident.
 */
export function detectLanguage(text: string): string | undefined {
  const counts = countScripts(text)
  const { cjk, kana, hangul, latin, cyrillic, arabic, thai, devanagari, hebrew, greek } = counts
  // Kana presence with at least a supporting CJK/Latin body marks Japanese,
  // which borrows all three scripts freely.
  if (kana >= 1 && kana + cjk + latin >= MIN_SCRIPT_LETTERS && kana + cjk >= latin) return 'ja'
  if (hangul >= MIN_SCRIPT_LETTERS && hangul >= cjk) return 'ko'
  // Chinese text routinely embeds Latin terms; ideographs keep the verdict
  // while they carry at least half the letters Latin contributes.
  if (cjk >= MIN_CJK_CHARS && cjk * 2 >= latin) return 'zh'
  if (latin >= MIN_LATIN_LETTERS && latin >= 2 * Math.max(cjk, kana, hangul)) {
    return classifyLatin(latinWords(text))
  }
  if (cyrillic >= MIN_SCRIPT_LETTERS && cyrillic >= latin) return 'ru'
  if (arabic >= MIN_SCRIPT_LETTERS && arabic >= latin) return 'ar'
  if (thai >= MIN_SCRIPT_LETTERS) return 'th'
  if (devanagari >= MIN_SCRIPT_LETTERS) return 'hi'
  if (hebrew >= MIN_SCRIPT_LETTERS) return 'he'
  if (greek >= MIN_SCRIPT_LETTERS) return 'el'
  return undefined
}
