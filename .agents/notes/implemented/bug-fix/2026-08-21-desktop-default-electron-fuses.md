# Agent Note: Desktop packaging keeps Electron default fuses

Status: implemented

English | [中文](2026-08-21-desktop-default-electron-fuses.zh.md)

## Problem

The packaged desktop startup composer is an ASAR-owned HTML file loaded with `BrowserWindow.loadFile()`. A Forge fuse policy that disabled `GrantFileProtocolExtraPrivileges` made Chromium reject that existing file with `ERR_FILE_NOT_FOUND`; Node `fs`, the ASAR header, and every per-file integrity hash still proved that `startup.html` was present and readable. The application quit before showing the local composer.

The [interactive cold-start decision](../architecture/2026-08-20-desktop-interactive-cold-start.md) owns the ASAR startup composer and deferred Host runtime. This note owns only the fuse policy that lets Chromium load that composer.

## Decision

Desktop Forge configuration does not register `FusesPlugin` or any other fuse override. The packaged binary keeps the Electron 42.7.0 fuse defaults, including `GrantFileProtocolExtraPrivileges: true`, so `file:///.../app.asar/assets/startup.html` loads through the normal Electron path. The dependency manifests and locks carry no fuse-only packages.

The startup document, preload, and Host runtime ownership stay unchanged: the composer remains in ASAR, the deployed runtime remains a physical `Resources/runtime` tree, and startup-policy verification still rejects missing required files, stale runtime content, and non-target `node-pty` prebuilds.

## Alternatives considered

- **Keep the fuse plugin and enable only `GrantFileProtocolExtraPrivileges`.** This preserves an owned fuse matrix without a product requirement. Electron's default fuse state is the compatibility input for the startup composer, and an unnecessary override adds another release dependency and test contract.
- **Move the startup composer outside ASAR.** The cold-start policy classifies the composer as required ASAR content. Duplicating it under `Resources` would add a second startup-file location without improving the runtime path requirements that keep the Host outside ASAR.
- **Load the composer through a custom protocol.** A privileged local protocol belongs to the later desktop IPC carrier. Introducing it only to compensate for a fuse override would expand main-process routing before the product needs that carrier.

## Consequences

The installed application opens its local startup composer before Host readiness, while the window keeps its existing `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, navigation, and permission restrictions. Future fuse hardening must first replace the startup document's `file` loading path and then prove the packaged application launches.

## Testing

The Forge configuration spec rejects registered plugins and keeps the product identity, icon, DMG maker, runtime, and legal resources intact. A packaged App with the former fuse policy reproduced `ERR_FILE_NOT_FOUND`; the same App with only `GrantFileProtocolExtraPrivileges` restored loaded `startup.html`. The packaged application launch remains the acceptance check for the final DMG.
