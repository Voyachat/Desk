# AI Staff Desktop Runtime

This private deploy manifest owns the production dependency closure embedded in the desktop application. `scripts/stage-runtime.mjs` uses the repository's pnpm workspace to deploy production packages, materializes every link, copies the built CLI to `runtime/apps/cli`, and verifies the web assets, AI Staff Client plugin, language-policy runtime chunk, worker entry points, and macOS x86_64 `node-pty` prebuild before atomically replacing `runtime/`.

The staged directory is copied by Electron Forge as `Contents/Resources/runtime`, outside `app.asar`. It is generated output and must be rebuilt after any DSH runtime package changes. Run staging serially: pnpm's legacy deploy can replace workspace links, so restore the repository's pnpm install before invoking Electron Forge or other workspace commands.
