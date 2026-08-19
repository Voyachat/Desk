# @voyaseek-ai/dsh-image-fallback

English | [中文](README.zh.md)

`ctx.imageFallback` turns durable image-bearing content into text before a text-only model receives it. A configured hosted vision route performs scene understanding only while its credential reference is configured; local document conversion handles an absent credential or hosted failure. The service never describes a hosted model as permanently free and never bundles a provider key.

The returned text preserves numbered image anchors and wraps analysis in `<image-analysis>`. The original image references remain beside the attribution for conversation display, attachment authorization, and export. Native image-capable destination models bypass this service.

## Routing and health

`routes` is ordered. The shipped composition uses `glm-4.6v-flash` (`free`), `glm-4.6v-flashx` (`paid-low`), `glm-4.6v` (`paid-quality`), then local macOS OCR. Only availability failures (`RATE_LIMIT`, `QUOTA`, server, timeout, transport, closed stream, empty response, missing adapter, or unknown model) advance to the next hosted route. Authentication and invalid configuration stop paid escalation and may only fall back locally. A failed availability route enters a 60-second in-memory cooldown.

`ping_image_fallback` sends a minimal `PING` request and checks declared image input for each route. It probes free routes by default; `include_paid: true` explicitly permits paid probes. It returns `available`, `cooldown`, `unconfigured`, or `not-probed` without exposing credentials.

The shipped Zhipu route reads `ZHIPUAI_API_KEY` through the credential service. When configured, image transfer to Zhipu is automatic and produces no extra confirmation prompt. Missing credentials skip every hosted Zhipu route and use local conversion.

## Model Experience

### Automatic image fallback

#### What the model sees

The destination text model receives the user's text, numbered image anchors, and one analysis block. It never receives image bytes or a message instructing it to switch models.

#### Token effect

Hosted analysis spends one separately metered vision request capped by `maxTokens`; its returned description remains in the destination conversation until compaction. Local conversion adds only the returned OCR text.

#### KV Cache effect

The analysis is an append-only text suffix. Earlier request prefixes remain reusable; the description joins subsequent cache identity.

## Known Limitations and Deferred Work

- Local conversion is OCR and does not replace scene understanding.
- Hosted availability, pricing, quota, and rate limits remain provider-owned and may change.
