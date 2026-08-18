/** Local macOS Vision provider for document-to-Markdown conversion. */

import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import { ocr } from 'mac-ocr'
import { DocumentConverter, DocumentConversionError } from '@voyaseek-ai/dsh-document-converter'
import type { DocumentConversionInput, DocumentConversionResult } from '@voyaseek-ai/dsh-document-converter'

/** Upstream version bundled as this provider's native OCR runtime. */
export const MAC_OCR_ENGINE = 'mac-ocr@1.1.1'
/** Default complete Markdown byte cap. */
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
/** Default conversion deadline. */
export const DEFAULT_TIMEOUT_MS = 2 * 60 * 1_000

/** Apple Vision recognition and operation limits. */
export interface Config {
  /** BCP-47 recognition languages, in preference order. */
  languages?: string[]
  /** Use the faster, lower-accuracy Vision recognizer. */
  fast?: boolean
  /** Complete Markdown byte cap across all inputs. */
  maxOutputBytes?: number
  /** Conversion deadline in milliseconds. */
  timeoutMs?: number
}

/** Validated provider configuration. */
export const Config: z<Config> = z.object({
  languages: z.array(String).default([]),
  fast: z.boolean().default(false),
  maxOutputBytes: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_BYTES),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

function operationSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

/** Local provider invoking the bundled universal macOS Vision binary. */
export class MacOcrDocumentConverter extends DocumentConverter {
  static Config = Config
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = config as ResolvedConfig
  }

  async convert(inputs: readonly DocumentConversionInput[], signal?: AbortSignal): Promise<DocumentConversionResult> {
    if (inputs.length === 0) {
      throw new DocumentConversionError('document conversion needs at least one input', 'FAILED')
    }
    const combined = operationSignal(signal, this.config.timeoutMs)
    const documents = []
    let outputBytes = 0
    try {
      for (const input of inputs) {
        const pages: string[] = []
        for await (const page of ocr.pages(input.data, {
          signal: combined,
          fast: this.config.fast,
          ...this.config.languages.length === 0 ? {} : { languages: this.config.languages },
        })) {
          const text = page.text.trim()
          if (text.length > 0) pages.push(text)
        }
        const markdown = pages.join('\n\n').trim()
        if (markdown.length === 0) {
          throw new DocumentConversionError('local OCR returned empty Markdown', 'INVALID_OUTPUT')
        }
        outputBytes += Buffer.byteLength(markdown)
        if (outputBytes > this.config.maxOutputBytes) {
          throw new DocumentConversionError('local OCR exceeded its output limit', 'OUTPUT_LIMIT')
        }
        documents.push({ name: input.name, markdown })
      }
    } catch (error) {
      if (error instanceof DocumentConversionError) throw error
      if (combined.aborted) throw new DocumentConversionError('local OCR was cancelled or timed out', 'FAILED')
      throw new DocumentConversionError('local Apple Vision OCR failed', 'FAILED', { cause: error })
    }
    return { provider: 'mac-ocr-local', engine: MAC_OCR_ENGINE, documents }
  }
}

export default MacOcrDocumentConverter
