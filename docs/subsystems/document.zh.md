# 文档转换

[English](document.md) | 中文

文档转换 seam 接受带名称、声明媒体类型的不可变字节，并按原顺序为每个输入返回一份 Markdown。结果会标明生成它的 provider 和 engine，因此模型可见归属不依赖进程日志。

Provider 会在返回前拒绝空结果、格式错误、超时和超出大小限制的结果。自动图片 fallback 可以在托管路由不可用后使用该 seam。OCR 输出是文字提取结果，不是通用场景理解。

随附的 macOS provider 使用 MIT 许可的 `mac-ocr` Node API 及其 Apple Vision 通用二进制文件，在本机支持图片与 PDF。Windows 与 Linux 组合在挂载其他 provider 前不会提供该 seam。

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
