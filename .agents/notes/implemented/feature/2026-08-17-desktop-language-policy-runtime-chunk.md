# Agent Note: Desktop staging carries the language-policy runtime chunk

Status: implemented

English | [中文](2026-08-17-desktop-language-policy-runtime-chunk.zh.md)

## Problem

The Aistaff language-policy Host plugin and invariant compile as separate entries that share `rules.ts` through a content-hashed `lib/rules-*.js` chunk. The package publication list included only the two entry files and declarations. The desktop runtime deploy therefore copied `lib/index.js` with its relative chunk import but omitted the referenced file, so every packaged Voyaseek launch stopped before readiness with `ERR_MODULE_NOT_FOUND`.

## Decision

`@deepseek-ai/dsh-aistaff-language-policy` publishes `lib/rules-*.js` as an explicit package artifact. The workspace package-file policy owns the same extra entry, and desktop runtime verification requires one matching physical chunk and imports the staged plugin entry before Electron Forge can consume the directory.

## Alternatives considered

**Publish only the entry files and declarations.** That was the incomplete artifact set: `lib/index.js` retained its relative import while the referenced runtime chunk was absent.

**Pin one build-specific chunk filename.** The chunk is content-hashed, so the package and staging rules match the artifact pattern rather than encoding a filename that changes with the compiled content.

## Consequences

- The packaged Host plugin and invariant resolve the same compiled rule implementation.
- A stale or incomplete staged runtime fails during `verify:runtime` instead of producing a DMG that exits during launch.
- The chunk remains content-hashed; the package and staging rules do not pin a build-specific filename.
