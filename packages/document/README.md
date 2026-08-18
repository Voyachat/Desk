# document/ — local document conversion

English | [中文](README.zh.md)

Document-to-Markdown capability used by Host adapters before a text-only model request.

| Package | Role | ctx key |
|---|---|---|
| [`document-converter/`](document-converter/README.md) | Provider-neutral conversion service | `ctx.documentConverter` |
| [`document-converter-mac-ocr/`](document-converter-mac-ocr/README.md) | macOS Apple Vision provider for images and PDFs | provides `ctx.documentConverter` |

The macOS provider is disabled outside Darwin compositions; Windows and Linux may add another provider without changing the Host consumer.
