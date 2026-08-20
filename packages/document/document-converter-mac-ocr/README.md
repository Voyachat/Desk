# @voyaseek-ai/dsh-document-converter-mac-ocr

English | [中文](README.zh.md)

Local `ctx.documentConverter` provider backed by the MIT-licensed `mac-ocr@1.1.1` Node API and its bundled universal Swift binary. It sends image and PDF bytes to Apple's Vision framework on the same Mac, streams PDF pages, and returns one plain Markdown document per input without temporary files, Python, model downloads, API keys, or hosted requests.

The provider accepts multiple inputs in one operation and preserves input/page order. `languages`, `fast`, `timeoutMs`, and `maxOutputBytes` are deployment configuration. It intentionally drops searchable-PDF generation, URLs, passwords, bounding boxes, confidence candidates, structured document recognition, and the upstream service mode.

## Model Experience

Indirectly, through the Host image fallback that includes OCR Markdown in a text-model request.

#### KV Cache effect

OCR Markdown replaces image blocks in the affected request suffix.

## Known Limitations and Deferred Work

- This provider runs only on macOS 10.15 or later; another `ctx.documentConverter` provider is required for Windows and Linux distributions.
- The optional `mac-ocr` runtime is loaded on the first conversion; installations that omit optional dependencies can compose the provider, but conversion fails with `FAILED` until that runtime is installed.
- OCR preserves recognized text and page order but does not replace general visual reasoning about scenes or objects.
- Inputs and complete Markdown are buffered in memory and bounded by the caller and provider limits.
