# Agent Note: One-command Web acceptance

English | [中文](2026-08-20-one-command-web-acceptance.zh.md)

## Context

The assembled AiDesktop Web application depends on ordered Host, Client, and frontend artifacts. Its source Host and Client plugin watcher are separate processes, and a bare Vite page is not an application because it lacks `window.__DSH_BOOT__`. A feature session needs one repeatable entry that cannot silently serve stale artifacts, accept an unrelated HTTP listener, or leave either long-running process behind.

## Decision

The root `accept:web` command owns local Web acceptance orchestration. It selects an available loopback port, completes the existing root build, starts the existing Aistaff source profile and Client plugin watcher, and waits until the served HTML contains the assembled boot payload before handing the URL to the operating system's default browser. When the default port is occupied, the command leaves its owner in place and selects the next available port; an explicit port is an exact request and is never replaced automatically. The launcher remains in the foreground and waits for both owned runtimes to stop during signal-driven cleanup.

Terminal output reports the current state as building, starting, ready, stopped, or failed. The launcher publishes its plain HTTP `Web 地址` line only together with ready, after the assembled HTML check succeeds, so terminals can link the address without presenting a reserved or failed port as openable.

The checkout-owned `scripts/aidesktop-accept` entry resolves the repository from its own real path and invokes the root command with pnpm's explicit working-directory option. A user may install a symbolic link to this entry in `PATH`; the global item contains no copied implementation or fixed repository path, and a moved or deleted checkout fails explicitly.

The complete build is the default freshness rule. The command does not infer which files changed or offer a skip-build mode because Host-generated Remote declarations, Client bundles, and the frontend shell have an ordered dependency. The existing two-command development workflow remains available for specialized use; direct Vite startup is not an acceptance path.

## Consequences

When the default port is occupied, the command starts the current build on another port without reusing or stopping the owner, so parallel acceptance needs no advance port coordination. Automatic fallback applies only to the default; an occupied explicit port still fails. The command works outside the repository root when invoked through the installed entry. Callers can distinguish progress, readiness, normal stop, and failure from stable labels, and only a ready run emits an openable address. Client plugin edits reload while the launcher remains active. Web shell changes, Host contract changes, and plain-package changes require restarting the command, which rebuilds all consumed artifacts before reopening the application. Browser hand-off failure leaves the verified URL visible for manual opening.

## Verification

Focused tests cover argument validation, lifecycle-status rendering, URL publication, exact port ownership, default-port fallback, assembled-application detection, and shell-free browser commands. A manual acceptance run exercises the real root build, source Aistaff profile, Client watcher, HTTP readiness check, browser handoff, and signal-driven cleanup path; the unit suite does not claim that assembled-runtime coverage.
