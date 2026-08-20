# Agent Note: Premature-stop recovery

Status: implemented

English | [中文](2026-08-20-premature-stop-recovery.zh.md)

## Problem

A provider can return `stop` after generating prose that announces an immediate next action without emitting the tool call. The default agent loop correctly normalizes that provider response but cannot equate provider intent with user-task completion. Treating every text-only `stop` as `turn/end: completed` makes the UI display a successful settled Turn even though no promised action ran.

## Decision

`@voyaseek-ai/dsh-premature-stop-recovery` observes the existing `agent/turn-stopping` extension point. It inspects only the last standard provider finish and assistant message in the open Turn, requires `finish.kind: stop`, rejects messages containing a tool call, and matches bounded unconditional Chinese or English action-commitment tails. A match steers a fixed plugin-sourced message into the next Step of the same Turn. Each Agent and Turn has a configured consecutive no-progress limit. Only a successful append-only `tool/result` without a durable error identity resets that limit; thrown errors, validation failures, denied calls, cancellations, and result-content replacements do not. Productive multi-step work therefore continues without a total-turn cap, while exhausting the limit admits one fixed incomplete-result reporting Step, after which another matching response closes with a warning.

The recovery message is an ordinary durable `user/message`, so request reconstruction, persistence, replay, UI history, and Session export all retain the decision without a new event type or diagnostics store. `max-tokens`, errors, cancellation, alternative drivers without standard finish evidence, result statements, and conditional offers are unchanged.

## Consequences

The reproduced Chinese tails continue automatically and preserve one Turn boundary. Successful append-only tool results reset the no-progress counter, so repeated interruptions do not end an otherwise advancing task and unsuccessful calls cannot indefinitely refresh its continuation budget. Every intervention is attributable in the Session log, while a repeatedly noncompliant model cannot create an unbounded no-progress loop. Detection is intentionally incomplete: false negatives leave the provider stop unchanged, and broader semantic task verification remains with goal policies.

## Alternatives considered

Changing `agent-loop` to treat every provider `stop` as uncertain was rejected because ordinary text completion is valid and the documented stop hook already supports data-driven continuation. A second debug log was rejected because the Session log already contains the provider finish, assistant text, recovery source, subsequent tools, and final Turn reason. Running a verifier model after every response was rejected because it adds latency and cost to normal conversations and overlaps explicit complex-goal verification.
