# Image Fallback

English | [中文](image-fallback.zh.md)

The image fallback seam converts durable image-bearing content into attributed text for destination models that do not explicitly accept images. Browser prompt admission and `read_image` share the same ordered hosted routes, cooldown state, and local conversion fallback. Native vision routes bypass the service.

The shipped route policy is current-free, low-cost paid, quality paid, then local OCR. Availability failures may advance through that order; authentication and configuration failures stop paid escalation. `ping_image_fallback` probes free routes by default and requires `include_paid` before sending paid probes. Provider pricing labels are deployment policy, not permanent guarantees.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctximagefallback--imagefallbackservice"></a>

### `ctx.imageFallback` — `ImageFallbackService`

Automatic image-to-text fallback shared by every conversation consumer.

```ts cordis-catalog
/**
 * Translate image-bearing content for a text-only destination model.
 * Hosted analysis runs only when its credential is configured; local conversion handles an absent credential or hosted failure.
 * @param content - durable content containing at least one image reference.
 * @param sessionId - session identity passed to the hosted LLM route.
 * @param signal - optional cancellation for attachment reads and provider work.
 * @returns text-only content, original display content, and analysis attribution.
 */
async translate(content: readonly ContentBlock[], sessionId: SessionId, signal?: AbortSignal): Promise<ImageFallbackResult>

/**
 * Probe configured routes with a minimal text request and update their shared health state.
 * @param includePaid - whether paid routes may receive a probe.
 * @param signal - cancellation for provider work.
 * @param sessionId - optional owning session for provider attribution.
 * @returns route status in configured order.
 */
async probe(includePaid: boolean, signal?: AbortSignal, sessionId?: SessionId): Promise<{ routes: ImageFallbackProbeResult[] }>
```

Types: [ContentBlock](llm-streaming.md) · [SessionId](core.md)

Source: [`packages/llm/image-fallback/src/index.ts:143`](../../packages/llm/image-fallback/src/index.ts)
<!-- END GENERATED cordis-surface -->
