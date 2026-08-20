# Agent Note: desktop startup is interactive before Host readiness

Status: implemented

English | [中文](2026-08-20-desktop-interactive-cold-start.zh.md)

## Problem

The packaged desktop application created its window only after profile preparation, two system PAC lookups, managed-runtime spawn, complete Cordis Loader settlement, a loopback proxy check, and Web navigation. Any cold filesystem read, Gatekeeper inspection, PAC delay, or Host plugin startup therefore looked like an application that had not opened. The readiness timeout was 30 seconds, while the packaged runtime contained more than 26,000 files; the user could neither enter a task nor select a mode during that interval.

A single “startup” label would not correct the behavior. Cordis Loader has no generic product phase, `inject` waits after module import, client `immediately` changes prefetch order but the Web kernel still creates every row before its settled UI, and `openAt` belongs only to the SQLite query provider. Required, deferred, and excluded work therefore needed observable execution and artifact rules.

## Decision

After `app.whenReady()`, Electron immediately creates a sandboxed window and loads an ASAR-owned local composer. The composer accepts a bounded plain-text draft and the shipped `standard` or `code` Agent Preset. Profile preparation, credentials, bounded system proxy discovery, and the complete managed Host start only after the local page is shown. Host or navigation failure restores the composer and exposes retry without discarding the in-process intent.

The preload exposes fixed startup channels only. Main validates the owning window, top-level sender frame, exact local document or managed loopback origin, preset, and 32,000-code-unit draft limit. The Web product waits for a real current blank Session, applies and records the preset, writes the draft without sending it, and acknowledges the intent only after those steps succeed. It does not create a placeholder Session or automatically retry a transport write with an unknown outcome.

The desktop startup policy has three current classes. `required` contains the local composer and emitted Electron main/preload JavaScript, which must remain local and within a 96 KiB logical-byte budget. `deferred` contains the complete deployed Host runtime and begins after the composer is shown. `excluded` contains `node-pty` prebuilds other than macOS x86_64; staging physically removes them and verification rejects their presence.

Ordinary desktop compilation verifies the required closure. Package and make additionally verify the generated runtime, an 800 MiB and 27,000-file ceiling, the target prebuild and license, worker and client artifacts, and the absence of non-target prebuilds. Staging uses pnpm's modern deploy against the shared lockfile in offline mode, skips deploy-time lifecycle scripts, materializes the closure, restores the `node-pty` `spawn-helper` executable mode, removes package-manager state, proves that `koffi` and `node-pty` still load, and accepts a real `/bin/sh` PTY only when it emits its marker, exits with code 0, and completes within three seconds.

The user-visible service level is launch request to a visible, focused, writable startup textarea, with `P95 <= 3,000 ms` over at least 20 cold launches on signed and notarized release-target hardware. Complete Host readiness is measured separately. An unsigned development application is not release cold-start evidence because macOS trust evaluation differs.

## Consequences

- A slow or failed Host no longer prevents task drafting or Agent Preset selection.
- Startup input lives only for the current Electron process and is never sent automatically. Application termination discards unacknowledged input.
- The current policy defers the Host as one unit. It does not claim that individual Host or client plugins are lazy.
- The build fails when the local critical closure grows past its budget, references a remote resource, or no longer matches the policy. Packaging fails when a stale runtime still contains excluded native targets or exceeds artifact budgets.
- The measured physical closure is 764,431,166 bytes and 26,779 files with the required macOS x86_64 Codex and Claude runtimes included. The 800 MiB ceiling leaves bounded dependency headroom without treating those product capabilities as removable packaging residue.
- Removing non-target `node-pty` prebuilds saves about 57.8 MiB. Further package removal requires evidence that no included entry or static import still needs it.
- Runtime signing and notarization remain mandatory release inputs. The local shell removes the Host from the first-interaction path but cannot bypass work macOS performs before Electron JavaScript starts.

## Alternatives considered

Waiting for the existing `dsh web:` readiness line before creating a window was rejected because it makes every Host and platform delay user-visible. Loading `apps/web/dist/index.html` directly was rejected because the Host injects its boot graph, serves client bundles, and owns the HTTP and WebSocket APIs. Automatically sending a retained draft was rejected because the current RPC has no durable client-intent idempotency key.

Adding a generic `phase` field to vendored Loader was deferred. The current Loader would ignore that product meaning unless entry creation, include composition, HMR, writeback, and both Host and browser readiness were changed together. A later fine-grained implementation can reuse zero-import `disabled` entries plus in-memory `loader.create()` after critical readiness, and can make the browser kernel create required rows before deferred rows. Until that controller exists, the policy truthfully treats the whole Host as deferred.
