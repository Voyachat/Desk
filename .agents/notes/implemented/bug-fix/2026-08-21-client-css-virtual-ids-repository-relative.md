# Agent Note: Repository-relative client CSS virtual ids

Status: implemented

English | [中文](2026-08-21-client-css-virtual-ids-repository-relative.zh.md)

## Problem

The `dsh-css-text-inline` and `dsh-css-global-inline` loaders built their virtual module ids from the stylesheet's absolute path. Rolldown prints each module id in the bundle's `//#region` banners, so every packaged `lib/client.js` embedded the build machine's repository path, and the desktop runtime staging gate (`rejectDevelopmentPaths`) refused the artifact.

## Decision

All three CSS virtual loaders in `packages/client/tsdown.client.ts` now share one registration path: the virtual id is `repositoryAssetId(abs)` — the repository-relative, forward-slash stylesheet path — and a per-config map keyed by the virtual id resolves the load hook back to the physical file. This is the mechanism the CSS Modules loader already used; the two newer loaders now follow it, including the same collision check and the same requirement that a stylesheet live inside the repository.

## Consequences

Built client bundles are byte-identical regardless of which directory the repository is checked out into, and runtime staging passes on any machine. A stylesheet outside the repository root fails at resolve time instead of leaking a host path into a shipped artifact.

## Alternatives considered

Stripping region banners from the output was rejected because the banners are rolldown's module map for debugging and the leak would remain in any other id-consuming output. Keeping absolute ids but relativizing only at banner time was rejected because the virtual id is also the module's dedupe key; two roots producing different ids for the same file would silently duplicate modules.
