# Electron desktop packaging

English | [中文](electron-packaging.zh.md)

This reference defines how DeepSeek Harness is packaged as a desktop application. The desktop distribution reuses the existing Cordis composition, Web client plugins, session persistence, tools, workers, and native helpers; Electron owns application lifecycle, the desktop window, packaged-resource discovery, and the eventual local IPC carrier.

## Fixed toolchain decisions

- The desktop application pins `electron` to exactly `42.7.0`; do not use a range. Electron 42.7.0 embeds Node.js 24.18.0, which satisfies the repository engine requirement `^22.19.0 || >=24.0.0` ([Electron release](https://releases.electronjs.org/release/v42.7.0)).
- Electron Forge is the packaging and installer tool. It integrates Electron packaging, native dependency rebuilds, platform makers, signing, and fuses; do not add a second release orchestrator without a requirement Forge cannot meet.
- Electron and Forge are adopted as versioned dependencies, not copied or forked source. Their licenses and transitive notices join `THIRD_PARTY_NOTICES.md` when the dependencies are added.
- The first packaged runtime remains outside ASAR. Cordis package discovery, profile package links, client bundles, worker entrypoints, native addons, and helper executables require real filesystem paths. A later ASAR change must prove every such path is unpacked and executable on each target.

### Product icon

Every AI Staff macOS package uses [`apps/aistaff-desktop/assets/app-icon.jpg`](../apps/aistaff-desktop/assets/app-icon.jpg) as the product artwork and its generated `app-icon.icns` as the distribution icon. Electron Forge must pass that same ICNS file to both `packagerConfig.icon` and the DMG maker `icon`; a build must not fall back to Electron's default icon or use a separate DMG icon. Replacing the product artwork requires an explicit product decision, regeneration of the complete 16–1024 px ICNS set, and updates to the Forge configuration test.

## Current runtime topology

The Web frontend is a Host-assembled plugin application, not a standalone static SPA. `apps/web` builds the shell, while [`@deepseek-ai/dsh-client-modules`](../packages/client/modules/README.md) discovers each `dsh.client` declaration, serves its `lib/client.js`, and injects `window.__DSH_BOOT__`. [`@deepseek-ai/dsh-client-connection`](../packages/client/connection/README.md) carries unary requests over HTTP and the mux and host event streams over WebSocket.

The existing Web profile already composes the complete Host runtime. [`prepareProfile()`](../packages/boot/app-boot/src/profile.ts) resolves `web` to the base and Web application bundles, the Web server may bind port `0`, and [`@deepseek-ai/dsh-web-app`](../packages/bundle/web-app/README.md) prints `dsh web: http://127.0.0.1:<port>` only after the loader has settled. The first desktop delivery uses that readiness line rather than duplicating Host assembly in Electron.

```text
Electron main
  -> Electron executable in Node mode
  -> @deepseek-ai/dsh/lib/bin.js --profile web --port 0
  -> Cordis Host, HTTP/WebSocket API, client bundles, and Web dist
  -> dsh web: http://127.0.0.1:<port>
  -> BrowserWindow.loadURL(exactReadyUrl)
```

Directly loading `apps/web/dist/index.html` is not a valid first delivery: the built HTML uses root-relative assets, the Host supplies the boot graph and plugin scripts, and the current client connection needs HTTP and WebSocket endpoints.

## First delivery: loopback desktop shell

The Electron main process starts the deployed CLI as a managed child process. It uses `process.execPath` with `ELECTRON_RUN_AS_NODE=1`, passes `--profile web --port 0`, accepts only the exact loopback readiness line from stdout, and opens that URL after readiness. The selected workspace is the child `cwd` and `DSH_CWD`; an Electron launch directory is never treated as the workspace.

The window starts with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webviewTag: false`. Navigation is limited to the exact ready origin, new windows are denied, permission requests are denied by default, and the renderer receives neither Node globals nor raw `ipcRenderer` access.

Application shutdown terminates the managed child and waits for the existing CLI signal path to dispose the Cordis tree. Packaged verification must prove that the Web port, workers, PTYs, and subprocesses are gone after exit; Windows may require a dedicated shutdown control path if ordinary process signals cannot meet that result.

The loopback API is a delivery step, not the final desktop trust model. Host and Origin checks reduce browser reachability but do not authenticate local processes, so the desktop package does not present the loopback form as a hardened local API.

## Deployable runtime closure

`apps/cli/package.json` is an application manifest, not the desktop deployment root. The desktop implementation adds a pure production manifest, `apps/desktop-runtime/package.json`, whose direct dependencies provide every required workspace peer for the Web profile. [`verify-runtime-closure`](../scripts/verify-runtime-closure.ts) must accept that manifest before packaging.

The deployment pipeline follows the proven staging pattern in [`build-exe-for-python-sdk.ts`](../scripts/build-exe-for-python-sdk.ts): run the repository build, execute a production `pnpm deploy` with a hoisted linker and automatic peer installation disabled, restore only required legacy-hoisted packages, dereference workspace links, and reject every remaining symbolic link. The Electron runtime is a deployed directory, not the Python JSON-RPC executable and not the repository root `node_modules` tree.

Forge copies the result to `process.resourcesPath/runtime` through `extraResources`. The runtime contains these file classes:

| Class | Required packaged content |
|---|---|
| Host packages | Built `lib` files, package manifests, bundle patches, and agent presets used by the selected composition |
| Web application | `apps/web/dist`, every selected `dsh.client` package manifest, and every selected `lib/client.js` |
| Workers | Code-runtime and workflow `worker.cjs` entrypoints and any package files they load dynamically |
| Native runtime | Platform-matched `.node` addons, `node-pty` helpers, ripgrep, Landlock launchers, Windows ACL helpers, and executable permission bits |
| Legal metadata | Project license plus generated Electron, Forge, Node, Chromium, native-package, and transitive third-party notices |

Native modules are rebuilt or validated against Electron 42.7.0 for every target OS and architecture. A successful source-tree test does not substitute for loading each addon and launching each helper from the packaged application.

## Writable state and external tools

Installation resources are immutable. Sessions, settings, credentials metadata, attachments, profile overrides, storage, skills, and other runtime state remain under `DSH_HOME`. The desktop application preserves the existing `~/.dsh` default unless the product explicitly chooses an isolated Electron data directory and supplies migration and concurrent-access rules.

The packaged JavaScript runtime does not imply an offline operating-system toolchain. Shell tools may call `bash`, `pwsh`, `git`, `python`, compilers, or other commands from the host `PATH`; bundling those programs is a separate distribution and licensing decision. Installing third-party profile plugins also requires pnpm, network policy, and install-script governance, so the first desktop delivery does not promise plugin installation.

Self-modification presets cannot edit signed installation resources. A desktop composition either disables source-editing behavior or redirects explicitly supported edits to a user-owned extension or preset directory.

## Target desktop carrier

The hardened desktop composition removes the listening Web server and replaces browser transports with Electron-owned local carriers. A privileged `dsh-app://` protocol serves the built shell, and an allowlisted `dsh-plugin://` protocol serves only client bundles present in the Host boot graph. The renderer never evaluates bundle text with `eval` or `new Function`.

A narrow preload API provides the boot manifest, unary request/response calls, and the mux and host event streams. The main process validates the sender frame and URL, fixed channel names, RPC method and path, request schema, and body limits. Stream delivery uses `MessagePort` or an equivalent bounded adapter, and closing a window cancels its ports and in-flight requests.

The existing [`AbstractApiClient`](../packages/host/apiproxy/src/fetch/client.ts) remains the client transport base: the Electron implementation overrides fetch and both event-stream methods while reusing the Typert gateway and API handlers. The Web boot entry also needs an asynchronous manifest provider and its existing bundle-loader replacement point. This composition belongs in a desktop-specific bundle instead of changing the Web profile's HTTP behavior.

## Implementation ownership

| Location | Responsibility |
|---|---|
| `apps/desktop` | Electron main and preload entries, window policy, managed runtime lifecycle, Forge configuration, icons, and makers |
| `apps/desktop-runtime` | Closed production dependency manifest used only to stage the packaged Host runtime |
| `scripts/` | Reusable runtime staging, symbolic-link rejection, artifact inspection, and packaged smoke launchers |
| `packages/bundle/desktop` | Desktop-only Cordis composition when the local protocol and IPC carrier replace the loopback delivery |
| Root scripts | Explicit desktop build, package, make, runtime-closure, and packaged-smoke entrypoints |

The first delivery needs the first three locations and root commands. `packages/bundle/desktop` is introduced with the IPC carrier, not as scaffolding around the loopback Web profile.

## Packaged acceptance

1. Build the Host libraries, Client libraries, and Web dist, verify the desktop runtime closure, stage a production runtime, and create a Forge package from a clean checkout.
2. Start the packaged application outside the repository on a machine without system Node or pnpm; confirm first-run profile initialization and the exact readiness URL.
3. Create and reopen a session, send a prompt through a keyless test provider, stream output, cancel a turn, and complete an approval interaction.
4. Exercise the terminal PTY, code-runtime worker, workflow worker, ripgrep search, and native directory picker from packaged resources.
5. Quit the application and confirm the loopback port is released and no managed child, worker, PTY, or helper process remains.
6. Inspect the artifact for repository paths, pnpm-store paths, symbolic links, missing client bundles, missing worker files, and unsigned or non-executable native helpers.
7. Run platform-native packaging checks: code signing and notarization on macOS, installer and ACL behavior on Windows, and sandbox or explicit degradation behavior on Linux.
8. For the target IPC carrier, additionally prove that no API socket listens, renderer Node globals are absent, CSP excludes `unsafe-eval`, navigation and new windows fail closed, malformed IPC requests are rejected, and reload or close tears down every stream.

## Distribution boundaries

The first supported targets and architectures, signing identities, installer formats, update policy, `DSH_HOME` isolation policy, bundled external tools, third-party plugin installation, and self-modification behavior are release inputs rather than implicit consequences of Electron packaging. Each target has its own native runtime and signing verification; a package built for one platform is not evidence for another.
