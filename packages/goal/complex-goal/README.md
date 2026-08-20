# @voyaseek-ai/dsh-complex-goal

English | [中文](README.zh.md)

Complex goals with independent environment verification, durable automatic recovery, and optional per-task Git worktrees. A root Agent may select `complex_goal` from the semantics of a direct human request in any language; `/goal-complex <objective>` remains available as the explicit Web command. The package reuses `ctx.goals` for the objective lifecycle, the owning session log for durable state, `ctx.agents` for cold resume, and fresh in-process subagents for Manager, Executor, and Auditor roles. The design adapts the Manager–Executor–Auditor boundaries from the MIT-licensed LongHorizon-Harness baseline recorded in [the open-source adoption ledger](../../../.open-source/adoptions.yaml), and the outer reconciliation pattern from the Apache-2.0 Symphony baseline recorded in [the reconciliation Agent Note](../../../.agents/notes/implemented/architecture/2026-08-20-durable-complex-goal-reconciliation.md); no upstream runtime, file ledger, dashboard, or source code is embedded.

## Behavior

The Manager receives the immutable objective and the latest Auditor-owned state but no environment tools. It selects one bounded contract or requests an audit. The Executor receives that contract in a fresh session and may modify the workspace under the parent session's existing permission policy. Its structured report remains an untrusted claim.

Before the Auditor starts, the host runs every command in `verificationGates` through `ctx.shell` with an explicit filesystem `read-only` sandbox policy. An executor that does not support sandboxing is rejected before command execution. The command, bounded output, exit status, and sandbox facts are persisted; a nonzero exit, timeout, sandbox denial, runner failure, or missing read-only sandbox report fails the check. The model cannot supply or alter these commands, and every configured check must pass before completion is possible.

The Auditor starts in another fresh session. A provider-owned creation hook appends `sandbox/mode: read-only` before publication and the shared delegation path pins approval to `never`; a fixed allowlist further limits the Auditor to observational tools present in the parent. Only `status: complete`, `integrity: clean`, and `alignment: aligned`, together with passed deterministic checks, commits completion. An Auditor response that claims completion while a check failed cannot replace trusted state. Every accepted audit replaces the complete trusted requirement, artifact, fact, and evidence state that a later Manager may read.

Every transition appends a complete version-3 `complex-goal/change` snapshot and flushes the parent session before the next side-effecting Executor starts. The snapshot freezes the task workspace, `verificationGates`, bounded evidence size, start time, wall-clock deadline, and any recovery attempt. The ordinary same-session goal driver is disarmed synchronously after goal creation. A persisted planning, executing, auditing, or paused state is discovered from session persistence and resumed automatically; executing or auditing always re-enters verification and audit before another Executor may run. Only a failure from an accepted maintenance claim whose paused revision remains current records a durable retry; a lost idle claim or a revision advanced by another owner does not count as a recovery failure. Consecutive automatic failures use durable exponential backoff and become a visible blocked goal after the configured limit. `/goal-complex resume` remains a manual recovery entry, not a required switch.

## Task workspace and promotion

`workspaceIsolation: auto` creates a detached Git worktree only when the session has a cwd, the source is a clean Git worktree, and `ctx.subprocess` is available. Non-Git and dirty sources continue in the shared session directory with a persisted degradation reason; `required` fails before goal creation instead. Manager has no environment tools, while the private Executor and Auditor providers both receive the frozen task cwd. Verification commands run there under read-only sandboxing.

An isolated goal never edits the source checkout during execution. After deterministic checks and the independent audit accept the full objective, the host builds one bounded binary diff against the frozen source commit, validates it with `git apply --check`, and applies it to the source checkout. Source HEAD movement or a patch conflict blocks completion and retains the worktree. A crash after application is idempotent: reverse-apply validation recognizes the exact patch as already present before the completion event is retried. Worktrees are retained for inspection; this package never deletes them.

## Automatic model entry

`complex_goal` is registered as a normal model tool and carries a system-prompt selection rule. Selection is semantic rather than keyword-based: a genuinely complex, dependent, multi-stage direct-human objective may trigger it in Chinese, English, or another language without a manual mode switch. Execution-time authority still requires the live top-level Agent and host-attested direct human input; subagents and non-human injected turns cannot start it.

## Commands

```text
/goal-complex <objective>
/goal-complex
/goal-complex resume
```

The bare command shows the current durable state. One non-complete ordinary or complex goal may own the session at a time.

## Configuration

`verificationGates` defaults to an empty list because no test command is correct for every employee workspace. A deployment or project overlay can pin the commands that are authoritative for its repositories:

```yaml
- id: complex-goal
  name: '@voyaseek-ai/dsh-complex-goal'
  config:
    automaticResume: true
    schedulerPollIntervalMs: 5000
    retryInitialDelayMs: 2000
    retryMaxDelayMs: 60000
    maxRecoveryAttempts: 5
    maxAutomaticResumes: 2
    workspaceIsolation: auto
    workspaceRoot: /absolute/durable/complex-goal-workspaces
    workspaceCommandTimeoutMs: 30000
    promotionPatchMaxBytes: 8388608
    maxDurationMs: 3600000
    verificationTimeoutMs: 120000
    verificationOutputMaxBytes: 8192
    verificationGates:
      - id: typecheck
        command: pnpm run typecheck
      - id: tests
        command: pnpm run test
        timeoutMs: 300000
```

Command order is stable and every configured command runs once per round. A restart reuses the persisted task workspace, verification plan, deadline, and retry state for the active goal; configuration changes apply only to a later goal. The package default keeps workspace isolation off for minimal compositions, while the shipped base bundle sets `auto` with a durable harness-home root.

## Extension points

The package consumes the existing agent, goal, session, shell, subagent, tool, sandbox-policy, approval, system-prompt, and command services. Session persistence activates its thin poll/reconcile/retry task plane; subprocess is used only for trusted argument-vector Git operations when workspace isolation is enabled. Two private role providers reuse the shared in-process driver to select the task cwd, with the Auditor adding the read-only override. It does not use process-local Jobs as durable authority, expose a second workflow engine, or modify `agent-loop`.

## Model Experience

### Semantic task selection

#### What the model sees

The root Agent sees the generated [`complex_goal` schema](../../../docs/tool-catalog.md#voyaseek-aidsh-complex-goal) plus the `tool:complex-goal` system-prompt rule that selects genuinely complex, dependent, multi-stage direct-human objectives from semantics in any language.

#### Token effect

The root request carries one stable tool definition and one short prompt section. The objective argument adds only the text inferred from the current direct human request.

#### KV Cache effect

The tool definition and selection rule remain stable across turns until the plugin version or configuration changes. The objective is call data and does not alter the reusable request prefix.

### Fresh role requests

#### What the model sees

The Manager sees the immutable objective, round limit, latest Auditor-owned state, prior audit, and prior verification result. The Executor sees one bounded contract and the trusted state. The Auditor sees the objective, contract, trusted state, Executor claims explicitly labeled untrusted, and authoritative deterministic command evidence; it must inspect the environment and return a structured verdict.

#### Token effect

Each round adds one fresh Manager request, normally one fresh Executor request, and one fresh Auditor request. An audit-only recovery omits the Executor request. Only the latest bounded audit state crosses rounds.

#### KV Cache effect

Each role runs in an independent fresh session. Stable persona and schema prefixes may be reused within a provider, while objective, contract, and audit state vary by run and round.

## Known Limitations and Deferred Work

- **One coordinator per persistence root** — poll/reconcile deduplicates work inside one process and the Agent registry remains the live collision boundary. It is not a distributed lease protocol; two harness processes must not coordinate the same writable session store.
- **Isolation is conditional** — `auto` records `not-git`, `dirty`, or unavailable-provider degradation and uses the shared workspace. Isolated promotion requires the source HEAD to remain at the frozen commit. It preserves staged and unrelated files but blocks on conflicting task paths.
- **Filesystem recovery is not external exactly-once** — an unknown Executor result is audited before re-execution and worktree promotion is idempotent, but tools that mutate remote systems still require their own idempotency keys and evidence. The filesystem sandbox cannot roll back or prove a remote side effect.
- **Retained worktrees** — successful and blocked task worktrees are not deleted automatically. Lifecycle cleanup and disk quotas belong to a later workspace-management surface.
- **Project-specific verification** — the safe default has no commands. A repository that requires deterministic tests must configure them in a trusted patch; model-generated commands are deliberately rejected as verification policy. The filesystem sandbox does not prevent a configured command from changing a remote service, so deployments must use observational commands and separately restrict network credentials.
- **Bounded Auditor tools** — the shipped Auditor can read/search files and session evidence but cannot invoke Bash or mutation-capable tools. Configured commands cover deterministic runtime checks, while GUI acceptance still needs observational tooling or a later dedicated verification provider.
- **No token or price budget** — round count and total elapsed time are bounded, but provider token and price accounting are not yet admission controls for this mode.
