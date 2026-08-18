# Document Conversion

English | [中文](document.zh.md)

The document conversion seam accepts immutable named bytes plus their declared media type and returns one Markdown document per input in the same order. A result identifies the provider and engine that produced it so model-visible attribution never depends on process logs.

Providers validate empty, malformed, timed-out, and oversized results before returning. The Host image fallback uses the local provider first and reaches an explicitly configured hosted vision route only when local conversion is unavailable. OCR output is text extraction, not general scene understanding.

The shipped macOS provider uses the MIT-licensed `mac-ocr` Node API and its universal Apple Vision binary. It supports images and PDFs locally; Windows and Linux compositions leave the seam unprovided until another provider is mounted.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdocumentconverter--documentconverter-abstract-seam"></a>

### `ctx.documentConverter` — `DocumentConverter` (abstract seam)

Provider-neutral document conversion service.

```ts cordis-catalog
/**
 * Convert one or more immutable documents to Markdown without publishing files.
 * @param inputs - complete validated documents in presentation order.
 * @param signal - optional cooperative cancellation.
 * @returns one Markdown document per input, in the same order.
 */
abstract convert(inputs: readonly DocumentConversionInput[], signal?: AbortSignal): Promise<DocumentConversionResult>
```

Source: [`packages/document/document-converter/src/index.ts:32`](../../packages/document/document-converter/src/index.ts)
<!-- END GENERATED cordis-surface -->
