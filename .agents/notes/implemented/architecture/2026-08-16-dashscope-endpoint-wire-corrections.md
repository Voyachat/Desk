# Agent Note: Endpoint-owned wire corrections override pi-ai URL detection

Status: implemented

## Problem

DashScope's OpenAI-compatible endpoint was fetchable in the models surface but its chat models failed in conversation. The family knowledge base materializes known reasoning families with `reasoning: true`, and pi-ai's OpenAI-completions dispatch sends a reasoning model's system prompt as `role: 'developer'` whenever its URL-derived compat detection says the endpoint supports that role. DashScope is an unrecognized OpenAI-compatible host, so detection defaults the support on, and the endpoint answers `"developer" is not one of ['system', 'assistant', 'user', 'tool', 'function']` with HTTP 400. Every agent conversation carries a system prompt, so every reasoning model on the route was unusable while non-reasoning ids on the same route worked. Live probes reproduced this for deepseek-v4-pro/-flash, kimi-k2.7-code, glm-5.2, qwen3-max, and qwen3.8-max on both `dashscope.aliyuncs.com` id spellings.

## Decision

Materialization applies endpoint-owned compat corrections after the profile compat chain, so the endpoint wins over the installed catalog entry, the route switches, and the model entry alike. A resolved baseURL whose host is `dashscope.aliyuncs.com` or `dashscope-intl.aliyuncs.com` forces `supportsDeveloperRole: false`; pi-ai then sends the system prompt as the `system` role, which every OpenAI-compatible endpoint accepts. The same probe set re-verified after the fix: all previously failing models complete tool-calling requests, and selecting `reasoning_effort: high` also succeeds, so the family table's effort declarations stay. DashScope's unactivated-model refusals arrive in two wordings (`The product is not activated` and a bare `Access denied`/`access_denied` body); the stream classifier now maps both to `MODEL_ACCESS_DENIED`.

## Alternatives considered

Setting the correction in the desktop profile or asking users to configure it was rejected because the fact belongs to the endpoint, not the deployment, and the symptom appears for any route pointed at that endpoint. Patching pi-ai's `detectCompat` was rejected because vendored packages stay pinned and product knowledge lives in the harness. Dropping `reasoningEfforts` from the family table was rejected because the failures came from the role switch, not the effort parameter, and removal would hide effort selection that the endpoint demonstrably accepts.

## Consequences

Reasoning models adopted from DashScope work in conversation without configuration, with their family capacities and selectable efforts. The correction cannot narrow a working endpoint because `system` is the universal OpenAI-compatible system role. Endpoints with similar refusals join the same correction table when evidenced; a `dashscope.e2e.ts` real-API suite (self-skipping without `DASHSCOPE_API_KEY`) guards the listing narrowing and the tool-carrying request path.
