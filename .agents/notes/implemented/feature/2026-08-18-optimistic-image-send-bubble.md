# Agent Note: Optimistic image send bubble

Status: implemented

English | [中文](2026-08-18-optimistic-image-send-bubble.zh.md)

## Problem

Image prompts perform browser-side serialization before Host admission. Clearing the composer at submit time therefore left no visible message during the slowest part of the send, while failures needed the original text and browser-owned images back without leaking their blob URLs.

## Decision

InputHub commits each ordinary send into the per-session input state as a local pending send before serialization begins. ChatView renders that state as a user-style bubble whose image blocks carry only local blob preview URLs. The accepted prompt RPC receipt removes the local bubble; the durable or queued Host projection then owns subsequent display. A rejection removes the bubble and restores its text and image ids only through the existing untouched-draft rollback rules.

The pending-send identity is local and monotonic for the browser process. Queue preview text is not an identity and does not settle a send, because two messages can have identical text and image counts. Session-scope disposal returns every image id still owned by pending sends to ConversationController, which releases their registry entries and blob URLs; a later asynchronous settlement is harmless.

## Alternatives considered

Waiting for the Host queue or durable event was rejected because image serialization happens before either projection exists. Matching a pending send to `session/queue` by its truncated preview was rejected because duplicate messages share that value and could retire each other's bubbles. Logging the optimistic row was rejected because it is presentation-only pre-admission state and the Host remains the authority for model-visible content.

## Consequences

Text and image messages appear in the conversation immediately after submit, including while browser serialization is running. Accepted sends hand off at the RPC commit point without retaining browser files, rejected sends recover their original draft inputs, and removing a session cannot retain an in-flight preview URL. The optimistic bubble is not replayed after reload because an unaccepted browser transaction has no durable session fact.
