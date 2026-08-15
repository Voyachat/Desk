# Agent Note: Dynamic Cordis source builds into durable stopped Packages

Status: implemented

## Problem

Dynamic Cordis definitions previously depended on process memory and evaluator-ready JavaScript bodies. A service restart lost Plugin and Package identity, and accepting TypeScript or TSX without an artifact owner would either require production to execute author source directly or let a failed rebuild replace the only usable version. Client development also had no normal file edit that could exercise the existing disposal-safe replacement path.

## Decision

`$DSH_HOME/dynamic-cordis` owns dynamic definitions. `registry.json` is the atomic commit point; it stores source, stable identity counters, immutable Package metadata, content-addressed JavaScript artifact digests, and the last successfully activated Package pointer. Artifacts are written before the manifest rename and verified as non-symlink regular files by SHA-256 on restore. The service root, artifact directory, and source directory must be physical directories. Fiber, handler, pending approval, run, and grant state are never stored.

The Host compiles JavaScript or TypeScript and the Client compiles JavaScript, TypeScript, or TSX before publication. Client JSX lowers to the `React` parameter already supplied by the existing evaluator. Imports and exports reject because dynamic halves remain function bodies without module resolution. Production runtime methods consume only compiled artifact text.

Stable development working copies live at `$DSH_HOME/dynamic-cordis/sources/<pluginId>/host.ts` and `client.tsx`. A disabled-by-default watcher serially compares file bytes. A successful change compiles all present halves, appends and atomically publishes an immutable Package, then uses the normal run request only when the Plugin is live and a prior user decision covers future Client versions. The Client runner's per-Plugin queue removes and drains the old Loader Fiber before mounting the new activation. A failed build changes neither the manifest nor the live activation and appears in inventory with a symbolic source path. Watcher disposal prevents later live activation.

## Alternatives considered

Persisting evaluator Fibers or a `running` boolean was rejected because neither proves a restored runtime effect and would silently execute code after restart. Re-evaluating retained TypeScript or TSX in production was rejected because source and artifact planes would be mixed and a compiler failure could remove the recovery path. Treating the mutable working file as the immutable Package source of record was rejected because HMR edits need a stable filename while Package identities must never change. Routing dynamic source edits through the static client-module SSE graph was rejected because dynamic Packages already have an exact run identity and a disposal-safe Loader entry path.

## Consequences

Definitions, Package identities, the current pointer, and the last usable artifacts survive restart, while every restored Plugin is stopped until an explicit run or approval path activates it. Broken edits remain available for correction without displacing the running Client UI. Development edits create immutable history and lose component-local React state because replacement intentionally mounts a fresh Fiber. The package manifests add TypeScript and test-only cross-runtime dependencies; the workspace lockfile and any shared composition that enables `developmentHmr` must be updated by the owning integration change.
