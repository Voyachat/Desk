# Agent Note: Model directories do not imply account access

Status: implemented

English | [中文](2026-08-16-model-directory-and-access-failures.zh.md)

## Problem

OpenAI-compatible `GET /models` responses advertise model identifiers but do not carry a portable guarantee that the current account has activated each model or that each identifier accepts chat requests. Treating every new identifier as selected writes heterogeneous image, audio, embedding, and account-gated products into the conversation catalog. When a provider reports an unactivated product as HTTP 400, pi-ai exposes only flattened error text, so the request otherwise looks like invalid user input.

## Decision

Endpoint interrogation remains a read-only catalog operation and never performs a hidden generation probe. Its picker starts every candidate unchecked and states that activation and chat support are unverified. This preserves unknown future chat models without relying on model-name allowlists or denylists and requires an explicit selection before configuration changes.

The pi-ai stream adapter recognizes only explicit product or model activation wording before its generic HTTP 400 classification and records `MODEL_ACCESS_DENIED`. Client projection maps that stable code to a dedicated model-access category whose guidance directs the user to activate the model or switch models. The same provider route remains usable by other models, and this terminal code is absent from the retry policy.

## Alternatives considered

Filtering identifiers by `image`, `audio`, `embedding`, or vendor naming conventions was rejected because names are not capability metadata and new chat models would be misclassified. Calling every discovered model was rejected because probes can incur cost, create provider-side effects, consume rate limits, and still fail for reasons unrelated to capability. Treating model activation as authentication was rejected because the same credential can successfully call another model on the route.

## Consequences

Fetching a large provider directory cannot silently populate the conversation selector. A selected but unactivated model fails with account-specific recovery guidance instead of an input-parameter instruction. Generic discovery still cannot prove chat, tool, or entitlement support; providers that expose authoritative capability metadata can add it to discovery in a separate change without changing this safe default.
