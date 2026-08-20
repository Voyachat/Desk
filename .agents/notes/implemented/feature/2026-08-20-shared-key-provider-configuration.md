# Agent Note: Shared-key provider configuration

Status: implemented

English | [中文](2026-08-20-shared-key-provider-configuration.zh.md)

## Problem

One provider credential can authorize more than one wire-compatible endpoint. DashScope, for example, exposes OpenAI-compatible, Responses, and Anthropic-compatible addresses under one credential, while the existing pi-ai route admitted alternative runtimes only when its single primary descriptor already used their protocol. The custom-provider form also asked users to invent a Provider ID even though the settings address and credential reference were implementation identifiers.

## Decision

A `llm-pi-ai` profile keeps `api` and `baseURL` as the Native descriptor and may add `alternateEndpoints`, with at most one non-empty endpoint for each other supported protocol. Every endpoint shares the route's `apiKeyEnv`; Codex selects `openai-responses`, Claude selects `anthropic-messages`, and Native continues to use the primary descriptor. The endpoint list declares protocol admission, not endpoint reachability or per-model entitlement.

The Models page generates the internal Provider ID from a matched recipe or display name and resolves collisions with a numeric suffix. The field is absent from the form. Configuration recipes run locally, use only unambiguous key prefixes or known provider names, and fill editable endpoint values without transmitting or retaining the key. A shared `sk-` prefix remains ambiguous, so the page asks for a provider name or manual endpoints instead of guessing. Smart repair restores the matched recipe but never changes the route id or stored credential.

The AI Staff generated profile disables the generic base bundle's DeepSeek plugin. Exact prior generated profiles migrate to that composition, while any user-edited profile remains unchanged.

## Consequences

A single custom route and credential can serve Native, Codex, and Claude when the provider exposes all three protocols. The primary endpoint remains the only source for model-catalog interrogation, and a configured badge does not claim that a paid request succeeds. An explicit connection check sends a fixed one-token request through each configured runtime, resolving the stored credential only on the Host and returning no provider body. Existing single-endpoint profiles remain valid because `alternateEndpoints` is optional. Generic DSH compositions retain DeepSeek; only the AI Staff product profile removes its default row.

## Alternatives considered

Creating a second provider route for every protocol was rejected because it duplicates the credential, model catalog, and user-facing provider identity. Inferring provider identity from every `sk-` key was rejected because several providers intentionally share that prefix. Keeping Provider ID visible as an advanced field was rejected because its validity and uniqueness can be derived without user judgment, while exposing it creates an avoidable setup failure.
