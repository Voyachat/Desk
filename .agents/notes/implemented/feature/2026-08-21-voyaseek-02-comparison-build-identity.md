# Agent Note: Voyaseek 0.2 comparison-build identity

Status: implemented

English | [中文](2026-08-21-voyaseek-02-comparison-build-identity.zh.md)

## Problem

The stable 0.1.x Voyaseek DMG remains the production install. The DSH rc.8 upgrade must ship as a separate DMG that installs and runs next to it, so reviewers can compare behavior without uninstalling the stable app or letting either build read the other's settings, sessions, or runtime state.

## Decision

The rc.8 branch packages the desktop app as the `Voyaseek 0.2` comparison build. The application name, executable, and DMG file all carry the `Voyaseek 0.2` name, the bundle identifier is `ai.voyaseek.desktop.v02`, `CFBundleShortVersionString` is `0.2`, and `CFBundleVersion` records the underlying `0.1.0-rc.8` package version. Because the app name differs, Electron resolves a separate `~/Library/Application Support/Voyaseek 0.2` userData directory, and the distinct bundle identifier keeps Launch Services, the dock, and the single-instance lock scoped per build. The workspace package version stays `0.1.0-rc.8` so every other workspace reference continues to track the upstream prerelease; only the packaged metadata presents `0.2`.

## Consequences

Both builds can be installed under `/Applications` and run at the same time with independent profiles, model credentials inputs, workspaces, and session databases. The stable branch keeps the `Voyaseek` identity and `ai.voyaseek.desktop` bundle identifier unchanged. When the 0.2 line graduates from comparison status, the stable branch adopts this identity and the version fields move together.

## Alternatives considered

Overriding `app.setPath('userData', ...)` in the main process was rejected because the distinct app name already isolates userData on macOS, and a path override duplicates a platform default without adding a guarantee. Renaming the workspace package version to `0.2.0` was rejected because workspace references and upstream-sync tooling key on the DSH prerelease version.
