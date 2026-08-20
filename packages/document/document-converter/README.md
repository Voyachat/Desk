# @voyaseek-ai/dsh-document-converter

English | [中文](README.zh.md)

The provider-neutral `ctx.documentConverter` service converts complete in-memory documents to Markdown. Callers retain source ownership; providers return complete Markdown values and do not publish output files.

## Model Experience

Indirectly, through consumers that include recorded converted Markdown in a model request.

#### KV Cache effect

Converted Markdown changes the affected request suffix when a consumer includes it.

## Known Limitations and Deferred Work

- The service accepts complete in-memory inputs; streaming large documents is deferred.
- Layout artifacts, embedded images, and provider-specific JSON stay outside the shared result.
