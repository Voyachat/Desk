# Agent Note: Local OCR, read-only mobile view, and model discovery

Status: implemented

English | [中文](2026-08-18-local-ocr-mobile-view-and-model-discovery.zh.md)

## Problem

Text-only model routes need useful image text without spending vision API calls, a phone needs a narrow way to observe active conversations without inheriting the desktop control plane, and model selection work needs authoritative Chinese ecosystem discovery without importing a complete training SDK. These capabilities have different trust and platform constraints, so a shared remote-agent service would couple unrelated authority.

## Decision

`ctx.documentConverter` is a provider-neutral document-to-Markdown seam consumed by the Host image fallback. The shipped Darwin provider depends on `mac-ocr@1.1.1`, sends bytes through its Node API to the bundled universal Swift binary, and returns bounded text in input and PDF-page order. The base bundle disables this provider outside Darwin. A text-only route uses local conversion first; an optional hosted vision route remains an unavailable-provider fallback, never an implicit replacement for a failed local OCR operation.

`mobile-view` registers the local `/mobile-view` page and two Bearer-authenticated JSON reads. When `remoteHost` is configured, it starts a second HTTP listener that serves only those three routes. The listener requires the credential before binding and does not expose the main Web server, commands, tools, files, uploads, downloads, cookies, or write methods. Tokens stay in page memory and request headers.

`modelscope_search` invokes the pinned official `modelscope-hub==0.2.0` client through the managed subprocess seam and projects only bounded repository metadata. The API token enters the child environment, not argv. Model download, repository execution, upload, training, serving, plugins, MCP, and the complete `modelscope` SDK remain outside the plugin.

## Alternatives considered

Docling was rejected as the shipped macOS image fallback after its pinned CLI repeatedly entered a long `docling-parse` source build on the supported Intel Mac, even with Python 3.12. PaddleOCR and Docling together were rejected because two heavyweight OCR stacks duplicate runtime, model, and packaging costs. `mac-ocr` supplies a tested universal binary, uses the operating-system recognizer, requires no model cache or API key, and supports multiple images and PDFs.

The DSH Remote implementation was not copied. Its general remote-control surface, query-carried or browser-persisted token patterns, file transfer, commands, daemon, and wildcard listener exceed a message viewer's authority. The local plugin keeps only the product idea and uses existing WebServer, SessionQuery, and credentials services.

The complete ModelScope SDK was rejected because catalog discovery needs only the independently released Hub client. Direct repository download or local model execution can be added later as separate capability seams with their own license, storage, and code-execution policies.

## Consequences

macOS gains a no-key OCR path whose package and upstream baseline are locked in the open-source adoption ledger and third-party notices. Windows and Linux keep the seam unprovided rather than silently using an incompatible provider. OCR extracts text but does not replace scene understanding, and no hosted provider is described as permanently free or receives a bundled key.

Remote phone access requires an explicit listener host and a configured bearer credential. TLS remains the responsibility of a private mesh or allowlisted reverse proxy. ModelScope search may populate uv's package cache on first use but does not change application state or execute model repositories.
