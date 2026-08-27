# Agent Note: Open the desktop directly on the Runtime home

Status: implemented

English | [中文](2026-08-22-desktop-direct-runtime-home-startup.zh.md)

## Problem

The desktop cold-start composer duplicated the Web product's primary input, Agent Preset selection, and visual identity before replacing itself with the actual application. Supporting that temporary page required three local assets, a preload IPC bridge, sender validation, process-local intent state, retry behavior, and a browser handoff that waited for an empty Session. Users still had to wait for the Runtime before they could use the product, and the first screen did not match the destination they expected to open.

The earlier [interactive cold-start decision](../../archived/architecture/2026-08-20-desktop-interactive-cold-start.md) optimized time to a temporary input surface. Product acceptance instead requires the first visible window to be the default Web home, without a startup page or an intermediate blank frame.

## Decision

After Electron is ready, Main creates the sandboxed `BrowserWindow` with `show: false`, then starts the complete managed Runtime. It accepts the exact loopback readiness URL only when Electron resolves it as direct-only, registers `ready-to-show` before navigation, and loads that URL. The window is shown only after both navigation and the Renderer's first frame complete.

Home navigation has a 30-second deadline. A Runtime launch, proxy, navigation, first-frame, or unexpected-exit failure stops owned work, displays one native error dialog, and exits. It does not reveal a blank window, restore a local page, retain a draft, or offer an in-window retry path.

The startup HTML, CSS, JavaScript, IPC handler, preload bridge, Client startup-intent consumer, and their tests are removed. The empty sandboxed preload remains because the BrowserWindow configuration names a packaged preload artifact. The startup policy's `required` category contains only emitted Electron `.js` and `.cjs` files; the managed Runtime begins after BrowserWindow creation and remains one coarse deferred unit.

## Alternatives considered

**Keep the local composer but skip its draft handoff.** Rejected: it would retain a duplicate screen and still make the first visible page differ from the application home.

**Show the hidden window immediately after `loadURL()` resolves.** Rejected: Electron can resolve navigation before the first rendered frame, exposing a white intermediate window.

**Load the static Web bundle directly.** Rejected: the managed Host owns the boot graph, client bundle delivery, HTTP and WebSocket APIs, and the authoritative default route.

## Consequences

- A cold start has no editable pre-Runtime surface; users begin work only after the real application is ready.
- The first visible frame is the default Web home. Slow startup leaves the application window hidden rather than showing temporary UI.
- Startup failure is explicit and terminal for that launch. Recovery is reopening the application after correcting the cause.
- Fine-grained Host lazy loading remains outside this decision; the complete managed Runtime still starts as one unit.
