/** Document-to-Markdown Service Definition (`ctx.documentConverter`). */

import { Context, Service } from '@voyaseek-ai/cordis'
import type { DocumentConversionInput, DocumentConversionResult } from './types.ts'

export type { ConvertedDocument, DocumentConversionInput, DocumentConversionResult } from './types.ts'

declare module '@voyaseek-ai/cordis' {
  interface Context {
    documentConverter: DocumentConverter
  }
}

/** Safe provider failure with no source bytes or child-process output in its message. */
export class DocumentConversionError extends Error {
  /** Stable failure category for consumers. */
  readonly code: 'UNAVAILABLE' | 'FAILED' | 'INVALID_OUTPUT' | 'OUTPUT_LIMIT'

  /**
   * @param message - safe diagnostic text.
   * @param code - stable failure category.
   * @param options - optional causal error retained for local diagnostics.
   */
  constructor(message: string, code: DocumentConversionError['code'], options?: ErrorOptions) {
    super(message, options)
    this.name = 'DocumentConversionError'
    this.code = code
  }
}

/** Provider-neutral document conversion service. */
export abstract class DocumentConverter extends Service {
  constructor(ctx: Context) {
    super(ctx, 'documentConverter')
  }

  /**
   * Convert one or more immutable documents to Markdown without publishing files.
   * @param inputs - complete validated documents in presentation order.
   * @param signal - optional cooperative cancellation.
   * @returns one Markdown document per input, in the same order.
   */
  abstract convert(inputs: readonly DocumentConversionInput[], signal?: AbortSignal): Promise<DocumentConversionResult>
}

export default DocumentConverter
