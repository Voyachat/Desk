# Agent Note: Product locale drives UI and model-visible output

Status: implemented

English | [中文](2026-08-15-product-locale-model-context.zh.md)

## Problem

The Web language picker selected browser dictionaries only. Agent replies and generated deliverables therefore followed model inference or the prompt's incidental language instead of the user's product preference. Browser detection also remained provisional, so Host-side model assembly could not resolve the same effective language on a fresh profile.

## Industry evidence

Android's [per-app language guidance](https://developer.android.com/guide/topics/resources/app-languages) treats the application locale as a centralized persisted preference shared by system settings and an in-app picker, with system language as fallback. Unicode CLDR's [language matching guidance](https://cldr.unicode.org/downloads/cldr-43) gives explicit user choices precedence over inferred matches. W3C's [HTML language guidance](https://www.w3.org/International/docs/bp-html-lang/) uses BCP 47 content tags and identifies Simplified Chinese as `zh-Hans`. OpenAI's [Model Spec instruction hierarchy](https://model-spec.openai.com/2025-02-12.html) makes higher-authority absolute instructions outrank user instructions, so a product locale is expressed as an overridable default rather than an unconditional system command.

## Decision

`locale.preference` is the product's authoritative language preference. The browser locale registry consumes it for UI dictionaries. A fresh loopback browser uses supported `navigator` preferences only while the Host value is absent, then persists that effective choice through the existing settings scope. Explicit selection and subsequent Host reads replace the provisional value live.

The Host half contributes `user:locale` through `systemPrompt.context()`. The agent loop records the complete runtime-context snapshot before a model request, so each session can reconstruct the language input and receives a replacement snapshot after the preference changes. The context defines a default for assistant replies and newly created user-facing text across UI, HTML, tables, spreadsheets, documents, presentations, and images. It delegates explicit reply- or deliverable-specific language requests to the current user message, preserves existing content unless translation is requested, and excludes code, identifiers, commands, paths, logs, proper nouns, and quoted source text from automatic translation. Generated HTML uses the preference's BCP 47 content tag.

## Alternatives considered

A mutable process-global locale would split browser and Host state and leave model input absent from the session log. A static system-prompt section would change the request header after a preference switch and give the default higher authority than the user's current language request. Separate language fields on every generator would duplicate policy and miss deliverables produced directly by the Agent.

## Consequences

UI text changes immediately and every active session adopts the new preference on its next model request; existing messages and files remain unchanged. The stable system prompt does not change, and the replacement runtime-context message appends after retained history. A non-loopback browser remains process-local because the Host settings API does not authorize remote writes, so its Agent continues to use the Host preference.
