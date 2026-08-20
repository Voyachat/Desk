# Agent Note: Model failure presentation and todo settlement use safe projections

Status: implemented

English | [中文](2026-08-15-model-failure-presentation-and-todo-settlement.zh.md)

## Problem

Provider and SDK failure messages can contain raw response bodies, endpoint query parameters, or credentials. Rendering those messages in the conversation or retry row exposed untrusted diagnostics as primary user copy. A failed turn also left the last todo projection in `pending` or `in_progress`, which implied that work would continue after the model request had already terminated.

## Decision

The Client runtime projects every durable model failure from stable structured fields only. The projection classifies known codes and HTTP statuses, preserves a valid provider retry delay, and assembles a bounded diagnostic from code, status, retry delay, and request identifier. Provider message text is never copied into display facts or a terminal Turn Error node. Conversation UI localizes the category into actionable guidance; the safe diagnostic remains inside a closed disclosure in both terminal-failure and automatic-retry rows.

The todo tool keeps its model-visible and durable `pending`, `in_progress`, and `completed` states. Its read-side session projection owns failure convergence: an error `turn/end` maps `in_progress` to `failed`, maps `pending` to `blocked`, and preserves `completed`. A later `turn/start` still clears the previous plan. UI reads these projected terminal states directly and does not infer turn failure locally.

## Alternatives considered

Keeping raw provider text inside a collapsed disclosure was rejected because a disclosure remains a user-visible surface and cannot make credentials safe. Classifying failures from message substrings was rejected because provider wording is unstable and may itself contain sensitive data. Converging todo status inside `TodoPanel` was rejected because every other projection consumer would retain the incorrect active states. Rewriting the durable `todo/write` event was rejected because the event records the model's tool input before the later turn failure.

## Consequences

Raw provider JSON and credential-like message content no longer reach primary or diagnostic conversation copy. Quota, rate limit, authentication, network, timeout, provider availability, context-window, invalid-request, configuration, and unknown failures provide distinct recovery guidance without attributing a failure to the currently selected model. After a failed turn, the retained task panel has no running or pending item and does not claim that unstarted work failed.
