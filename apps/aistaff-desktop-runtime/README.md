# AI Staff Desktop Runtime / AI Staff 桌面运行时

English | [中文](README.zh.md)

This private deploy manifest owns the production dependency closure embedded in the desktop application. `scripts/stage-runtime.mjs` uses pnpm's modern deploy against the repository lockfile in offline mode, injects workspace packages without running deploy-time lifecycle scripts, materializes every link, restores the `node-pty` `spawn-helper` executable mode, and removes package-manager and development artifacts plus prebuilds for platforms other than macOS x86_64.

Before atomically replacing `runtime/`, staging verifies the web assets, AI Staff Client plugin, language-policy runtime chunk, worker entry points, native imports, `node-pty` license, and target prebuild.

The staged directory is copied by Electron Forge as `Contents/Resources/runtime`, outside `app.asar`. Verification rejects a runtime above 800 MiB or 27,000 regular files and reports both measurements as JSON. These budgets cover the complete staged directory; the current closure includes the macOS x86_64 Codex and Claude runtimes, so a dependency increase must remain within them or update the constants with a measured packaged-runtime justification.

The directory is generated output and must be rebuilt after any DSH runtime package changes. Complete the root pnpm install and repository build first: staging deliberately skips dependency lifecycle scripts, proves that the resulting physical `koffi` and `node-pty` artifacts load, and starts `/bin/sh` through a real PTY that must emit its marker, exit with code 0, and complete within three seconds before Electron Forge can consume the runtime.

[`startup-policy.json`](./startup-policy.json) is the authoritative coarse desktop startup classification and owns the required-byte budget. The local HTML, CSS, JavaScript, and built Desktop `.js`/`.cjs` files are required before interaction. The complete managed runtime is deferred until the startup shell is shown; the policy does not divide Host plugins into finer phases. Every `node-pty` prebuild except `darwin-x64` is excluded. `node scripts/verify-startup-policy.mjs --required-only` checks emitted startup code during ordinary Desktop compilation; the command without the flag additionally checks the generated runtime before packaging. Both forms emit one JSON summary.
