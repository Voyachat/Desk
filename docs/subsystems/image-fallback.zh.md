# 图片 Fallback

[English](image-fallback.md) | 中文

图片 fallback seam 把持久图片内容转换为带归因的文字，交给未明确接受图片的目标模型。浏览器 prompt 准入与 `read_image` 共用有序托管路由、冷却状态和本机转换 fallback；原生视觉路由绕过该服务。

交付路由策略依次是当前免费、低价付费、高质量付费、本机 OCR。可用性故障可以按顺序升级，认证和配置故障会停止付费升级。`ping_image_fallback` 默认探测免费路由，只有 `include_paid` 才允许发送付费探测。提供方价格标签是部署策略，不是永久保证。

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
