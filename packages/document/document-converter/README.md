# @voyaseek-ai/dsh-document-converter

English | [中文](README.zh.md)

The provider-neutral `ctx.documentConverter` service converts complete in-memory documents to Markdown. Callers retain source ownership; providers return complete Markdown values and do not publish output files.

## Model Experience

Indirect. A Consumer decides whether converted Markdown becomes model-visible and must record that input through its owning session event.

#### KV Cache effect

Converted Markdown changes the affected request suffix when a Consumer includes it in a model request.

## Known Limitations and Deferred Work

- The service accepts complete in-memory inputs; streaming large documents is deferred.
- Layout artifacts, embedded images, and provider-specific JSON stay outside the shared result.
