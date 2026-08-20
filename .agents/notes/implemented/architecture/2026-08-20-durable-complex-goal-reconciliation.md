# Agent Note: Durable complex-goal reconciliation

Status: implemented

English | [中文](2026-08-20-durable-complex-goal-reconciliation.zh.md)

## Problem

`complex-goal` already persisted independently verified round state, but process restart still required `/goal-complex resume`, every child inherited the source session cwd, and process-local Jobs could not coordinate cold sessions. Unattended tasks therefore stopped at the process boundary, while a rejected Executor could leave source files modified before the Auditor reported failure.

## Decision

The owning Session log remains the only durable task authority. Version-3 `complex-goal/change` snapshots add the frozen task workspace and bounded retry state. When session persistence is present, the plugin polls cheap revisions, inspects only changed cold logs, and reconciles planning, executing, auditing, or paused goals through `ctx.agents.resume()` and `Agent.runMaintenance()`. The live Agent registry prevents duplicate activation inside the process. An automatic failure commits an exponential-backoff `retry` transition only when maintenance acquired the idle claim and the paused checkpoint remains the current goal revision; a rejected claim or a checkpoint superseded by another owner does not consume an attempt. Reaching the configured consecutive-attempt limit blocks the goal. A blocked goal is never resumed automatically. A recovered executing or auditing phase still runs deterministic verification and the read-only Auditor before another Executor, so retry scheduling does not weaken the existing unknown-side-effect rule.

Workspace isolation is resolved before goal creation. `auto` creates a detached Git worktree only for a clean source and otherwise persists an explicit shared-workspace reason; `required` fails instead. A narrow provider-owned `cwd` option in the existing in-process subagent driver places the private Executor and Auditor in the frozen task directory without changing the parent Session. After all gates and the Auditor accept completion, trusted host code produces a bounded binary diff against the frozen commit and applies it only after `git apply --check`. Source HEAD movement or conflicts block completion and preserve the worktree. Reverse-apply validation makes a crash between patch application and the completion event idempotent.

This is an architecture adoption of OpenAI Symphony commit `8001b52e3062495a16e520e4ceaf8f9de868c4d0` (Apache-2.0): poll/reconcile/retry and per-task workspace are retained, while its Elixir runtime, tracker authority, Codex App Server client, hooks, and Dashboard are not copied. The persistent source review is `/Users/baron/projects/开源代码/_reviews/github.com--openai--symphony/README.md`; AiDesktop has no runtime dependency on that local path.

## Consequences

An eligible persisted complex goal continues after restart without a command, and retry timing survives another restart. Clean Git tasks isolate Executor changes and publish only an independently accepted patch; non-Git or dirty tasks remain usable with an observable degradation. The implementation adds no second workflow engine, generic durable scheduler, or `agent-loop` branch.

The coordinator is single-process, not a distributed lease service; one writable persistence root must have one harness coordinator. Worktrees are retained and need a later cleanup/quota surface. Filesystem patch recovery does not provide exactly-once semantics for remote APIs: mutation-capable tools still need provider idempotency and auditable receipts. `auto` cannot isolate an already dirty source without either losing user state or inventing a merge authority, so it deliberately uses the shared cwd.

## Alternatives considered

Depending on or forking Symphony was rejected because it would duplicate Session, Agent, Codex runtime, workflow, and UI authorities. A generic durable task service was rejected until a second real consumer proves a shared contract; the narrow complex-goal scheduler contains less code and can later be extracted without changing persisted events. Process-local Jobs were rejected as restart authority. Changing `agent-loop` was rejected because Agent factory resume and maintenance already expose the required lifecycle. Copying arbitrary directories was rejected because ignored dependencies, large assets, symlink handling, and merge-back semantics would create a second filesystem implementation.
