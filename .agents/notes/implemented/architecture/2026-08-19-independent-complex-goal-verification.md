# Agent Note: Independent complex-goal verification

Status: implemented

English | [中文](2026-08-19-independent-complex-goal-verification.zh.md)

## Problem

The existing goal driver continues one same-session model, while Ralph starts fresh workers but accepts their completion declaration. Neither path independently checks the real environment before certifying a complex task. Long-running work also needs a durable distinction between an Executor claim and Auditor-verified state without adding another agent loop or file ledger.

## Decision

`@voyaseek-ai/dsh-complex-goal` adds the human `/goal-complex` command and the semantically selected `complex_goal` model tool, then reuses the existing goal, session, shell, subagent, sandbox-policy, approval, system-prompt, tool, and command services. The model entry accepts any language but requires host-attested direct human input on the live root Agent. Each round starts a tool-less fresh Manager, a fresh Executor, and a fresh Auditor. A narrow provider-owned setup hook in the shared in-process subagent driver applies `sandbox/mode: read-only` before the Auditor is published; existing delegation logic pins approval to `never`.

The owning session log remains the only durable authority. Each version-2 `complex-goal/change` event carries the complete post-transition state, including frozen `verificationGates` and a wall-clock deadline. Executor reports are retained as untrusted claims. Before the Auditor starts, the host runs each exact configured command through `ctx.shell` with a forced filesystem read-only sandbox policy and persists bounded output plus enforcement facts. An executor without sandbox support is rejected before command execution; missing read-only enforcement, denial, timeout, runner failure, or nonzero exit fails the check. Only an Auditor result with `status: complete`, `integrity: clean`, and `alignment: aligned`, together with every configured check passing, may complete the underlying goal; an Auditor completion claim cannot overwrite trusted state after a failed check. Only accepted Auditor-owned requirement, artifact, fact, and evidence state crosses rounds. A persisted unknown execution resumes with verification and audit before any further Executor side effect.

The design adopts the Manager–Executor–Auditor separation and evidence gate from the MIT-licensed LongHorizon-Harness baseline at commit `be2e7b42523c4f35291f1ed57b683f6c03a29cdc`. The exact upstream paths, local implementation paths, differences, and upgrade policy are recorded in [the open-source adoption ledger](../../../../.open-source/adoptions.yaml). No upstream Python source or runtime dependency is embedded.

## Consequences

Independently observable false completion is rejected before the goal becomes complete, including a schema-valid Auditor false positive contradicted by deterministic evidence. Restart preserves the last verified state, verification plan, and total deadline. Each normal round costs three fresh model requests plus configured verification commands, and rejected execution effects are not rolled back. The filesystem sandbox does not prevent a trusted configured command from changing remote services, so deployment policy admits only observational commands and restricts their credentials. Explicit `/goal-complex resume` is required after restart or interruption; background scheduling, token or price admission, and transactional workspace isolation remain deferred.

## Alternatives considered

Depending on or forking LongHorizon-Harness was rejected because its Python CLI, file ledger, dashboard, and agent lifecycle would duplicate product authorities. Extending `agent-loop` was rejected because existing plugin seams already own orchestration and persistence. Extending Ralph was rejected because its foreground workflow has no durable verified-state owner, while changing its completion semantics would break its intentionally smaller contract.
