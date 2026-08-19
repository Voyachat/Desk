# Agent Note: Automatic image fallback routing

Status: implemented

English | [中文](2026-08-19-automatic-image-fallback-routing.zh.md)

## Problem

Image admission was split between browser prompts and `read_image`. Text-only routes either required front-door-specific configuration or refused the image and told the user to switch models. A Vision MCP cannot fix that admission boundary because MCP execution depends on the selected model deciding to call a tool, and pasted image bytes may never reach the MCP server. The product also needs a current free-first policy without treating provider pricing as a permanent promise.

## Decision

`@voyaseek-ai/dsh-image-fallback` owns `ctx.imageFallback`. Browser prompt admission and `read_image` call the same service whenever the selected route does not explicitly accept images. The service sends the durable image references to an ordered auxiliary vision route and replaces them with attributed text analysis for the destination model; native image-capable routes remain direct. The original browser-upload blocks stay in message source metadata for display, authorization, and export.

The shipped order is Zhipu `glm-4.6v-flash` (`free`), `glm-4.6v-flashx` (`paid-low`), `glm-4.6v` (`paid-quality`), then local macOS OCR. Provider documentation describes the first route as free today, not permanently free. Only availability failures advance to a paid route. Authentication and configuration failures stop hosted escalation and may use local OCR. A failed availability route enters a 60-second process-local cooldown.

The user authorized automatic image transfer to Zhipu. The deployment still requires a separately stored `ZHIPUAI_API_KEY`; no credential is bundled or written to the repository. AiStaff Desktop reads that value from the owner-only `~/.codex/secrets/zhipu.env` file and passes it only through the DSH child environment, using the same file validation as its Gemini and DashScope credentials. The shipped Zhipu profile uses the provider's `zai` thinking protocol with reasoning off so auxiliary descriptions and small pings spend their output budget on visible text. `ping_image_fallback` verifies route resolution, declared image input, and a minimal provider response. It probes only free routes unless `include_paid` explicitly permits paid probes.

## Consequences

Conversation models no longer need to know whether they can inspect images or ask the user to switch models. Hosted analysis adds a separately metered request and is lossy compared with native vision. Pricing, quota, and model availability remain provider-owned; route labels are editable deployment policy rather than guarantees. Process-local health is deliberately not durable, so restart clears cooldown state and the next request or ping rechecks the provider.

## Alternatives considered

The Zhipu Vision MCP and the community `cc-ds-glm-image-mcpServer` were not adopted as the primary path. They are useful explicit tools, but they do not intercept every prompt or tool-produced image, and their invocation depends on model tool behavior. Keeping separate Host and filesystem implementations was rejected because their routing, billing escalation, and health state would drift.
