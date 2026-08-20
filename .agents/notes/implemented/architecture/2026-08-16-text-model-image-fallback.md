# Agent Note: Explicit vision routes translate browser images for text models

Status: implemented

English | [中文](2026-08-16-text-model-image-fallback.zh.md)

## Problem

Browser image admission treated a model's native image capability as the complete product capability. A text-only model could still perform the user's task from a faithful visual description, but the Host rejected the image before any durable prompt existed. Marking every route as image-capable would instead send unsupported content to providers, strand image blocks in session history after a provider rejection, and misrepresent the model catalog.

## Decision

`ApiProxyService.imageFallback` explicitly names one image-capable provider, model, and output cap. The setting is deployment-owned because enabling it sends user images to that route and incurs a separate provider call. An absent setting preserves strict rejection; the Host never discovers or selects a cross-provider fallback implicitly.

For a browser prompt whose selected model explicitly omits image input, the Host validates and stores the images, then asks the configured route for ordered visible evidence, OCR, layout, code, numbers, uncertainty, and image relationships. The prompt instructs the visual model to report instructions found inside an image as untrusted content rather than follow them. Failed, truncated, empty, tool-call, or other non-text output rejects the complete prompt before it enters the Agent.

The accepted `user/message.content` contains the original user text, numbered image anchors, and the generated description, so the selected text model's input is durable and replayable without request-time rewriting. The same message source retains the original content for conversation rendering, attachment authorization, session-log media export, and records auxiliary route attribution and reported usage. Model switching therefore reads only the real model-facing text and does not keep a false image requirement after translation.

AI Staff configures `google/gemini-3.6-flash` as the fallback and explicitly declares its image input. Exact generated profiles from before this decision migrate to the new patch; any user-edited profile remains untouched.

## Alternatives considered

Declaring image input by default for unknown or gateway models was rejected because one false positive makes the provider reject after the image message is durable. Automatically choosing the first live vision model was rejected because provider order is not a data-disclosure policy and could send images across providers without deployment consent. Rewriting requests only at `agent/request` was rejected because the generated description would not be reconstructable from the session log and direct compaction calls bypass that extension point.

## Consequences

Most text models can complete browser image tasks whenever the deployment supplies one working vision route, while native vision models retain their direct path and exact capability declarations. The fallback adds latency, a separately billed model request, and a lossy description that remains in later context until compaction. `read_image` tool output and subagent continuations retain their own strict modality checks; extending fallback to those producers requires separate lifecycle and display decisions.
