/** Provider-neutral document-to-Markdown values. */

/** One immutable input document held entirely in memory. */
export interface DocumentConversionInput {
  /** Display filename used only to derive a safe output label and format hint. */
  readonly name: string
  /** MIME type already validated by the caller. */
  readonly mediaType: string
  /** Complete source bytes. */
  readonly data: Uint8Array
}

/** Markdown produced for one input document. */
export interface ConvertedDocument {
  /** Original display filename. */
  readonly name: string
  /** Complete Markdown output. */
  readonly markdown: string
}

/** One provider conversion result. */
export interface DocumentConversionResult {
  /** Stable provider id used for attribution. */
  readonly provider: string
  /** Exact upstream engine version or package specification. */
  readonly engine: string
  /** Results in input order. */
  readonly documents: readonly ConvertedDocument[]
}
