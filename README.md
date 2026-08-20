# AiDesktop

English | [中文](README.zh.md)

AiDesktop is an independent desktop AI client that uses Voyaseek Harness as its runtime and Client foundation and assembles Aistaff product capabilities as plugins.

## Current status

The repository contains an isolated DSH source baseline, Aistaff Client slot plugins, local UI fixtures, Host Remotes and bundles, Electron packaging code, and a runnable user-facing frontend demo.

- [Architecture](docs/architecture.md)
- [Development guide](docs/development.md)
- [Runnable frontend main-flow demo](apps/frontend-demo/README.md)

The real Aistaff Client Gateway, sign-in and Workforce flows, Cloud Run-to-Material projection, SSE replay, signed employee-package activation, Supervisor integration, and customer-release security requirements are not complete. Fixtures do not execute real Cloud employee tasks or local side effects.

## Development mode

`pnpm run dev:aistaff` starts the isolated `.aidesktop-dev` profile. This entry enables dynamic Cordis plugin HMR through a dedicated overlay while release profiles keep it disabled. Dynamic plugin definitions and the last successful JavaScript build persist under `$VOYASEEK_HOME/dynamic-cordis/` in that profile; editable sources live at `sources/<pluginId>/host.ts` and `sources/<pluginId>/client.tsx`.

## Run

AiDesktop runs from this repository through the isolated development profile.

### Run from source

Install a supported Node.js version and pnpm, then run:

```sh
pnpm install
pnpm run build
pnpm run dev:aistaff
```

The development command starts AiDesktop from the repository source with the isolated development profile.
