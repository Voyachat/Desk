# Agent Note: One-command Web acceptance

Status: implemented

English | [中文](2026-08-20-one-command-web-acceptance.zh.md)

## Problem

The assembled AiDesktop Web application depends on ordered Host, Client, and frontend artifacts. Its source Host and Client plugin watcher are separate processes, and a bare Vite page is not an application because it lacks `window.__DSH_BOOT__`. A feature session needs one repeatable entry that cannot silently serve stale artifacts, accept an unrelated HTTP listener, or leave either long-running process behind.

## Decision

The root `accept:web` command owns local Web acceptance orchestration. It selects an available loopback port, completes the existing root build, starts the existing Aistaff source profile and Client plugin watcher, and waits until the served HTML contains the assembled boot payload before handing the URL to the operating system's default browser. When the default port is occupied, the command leaves its owner in place and selects the next available port; an explicit port is an exact request and is never replaced automatically. The launcher remains in the foreground and waits for both owned runtimes to stop during signal-driven cleanup.

Terminal output reports the current state as building, starting, ready, stopped, or failed. The launcher publishes its plain HTTP `Web 地址` line only together with ready, after the assembled HTML check succeeds, so terminals can link the address without presenting a reserved or failed port as openable.

`accept:web:smoke` uses the same complete build, Client watcher, source Host, and assembled-HTML readiness test, then stops its owned processes immediately instead of opening a browser or waiting in the foreground. It is the bounded Host-plus-Client integration check for automation.

Reports are opt-in through `--report-dir <dir>`. After owned processes stop, the launcher writes `accept-web-report.json` and `accept-web.log` beneath that explicit directory with the commit SHA, clean or dirty working-tree state, checked URL, overall result, and stable check outcomes. It does not capture child-process output, environment values, credentials, or provider response bodies. The report records only screenshots deliberately placed beneath that explicit directory; an ordinary run writes no report or screenshot to the repository.

The checkout-owned `scripts/aidesktop-accept` entry resolves the repository from its own real path and invokes the root command with pnpm's explicit working-directory option. A user may install a symbolic link to this entry in `PATH`; the global item contains no copied implementation or fixed repository path, and a moved or deleted checkout fails explicitly.

The complete build is the default freshness rule. The command does not infer which files changed or offer a skip-build mode because Host-generated Remote declarations, Client bundles, and the frontend shell have an ordered dependency. The existing two-command development workflow remains available for specialized use; direct Vite startup is not an acceptance path.

## Alternatives considered

**Use the existing two-command development workflow or start Vite directly.** The development workflow remains useful for specialized iteration, but it does not provide one owner for ordered build freshness, Host and Client lifecycle, assembled boot readiness, and cleanup; a bare Vite page lacks `window.__DSH_BOOT__`.

**Infer changed files or allow a skip-build mode.** Host-generated Remote declarations, Client bundles, and the frontend shell have an ordered dependency, so the acceptance command performs the complete build instead of risking stale consumed artifacts.

**Reuse or stop an existing listener on the requested default port.** The listener may be unrelated, so the command preserves its owner and chooses another port; an explicitly requested occupied port fails.

## Consequences

When the default port is occupied, the command starts the current build on another port without reusing or stopping the owner, so parallel acceptance needs no advance port coordination. Automatic fallback applies only to the default; an occupied explicit port still fails. The command works outside the repository root when invoked through the installed entry. Callers can distinguish progress, readiness, normal stop, and failure from stable labels, and only a ready run emits an openable address. Client plugin edits reload while the launcher remains active. Web shell changes, Host contract changes, and plain-package changes require restarting the command, which rebuilds all consumed artifacts before reopening the application. Browser hand-off failure leaves the verified URL visible for manual opening.

## Verification

Focused tests cover argument validation, lifecycle-status rendering, URL publication, exact port ownership, default-port fallback, assembled-application detection, shell-free browser commands, and credential-free report serialization. `pnpm run accept:web:smoke -- --report-dir <external-dir>` exercises the real root build, source Aistaff profile, Client watcher, HTTP readiness check, report write, and signal-driven cleanup path without a paid model call. A foreground `accept:web` run additionally covers browser handoff.
