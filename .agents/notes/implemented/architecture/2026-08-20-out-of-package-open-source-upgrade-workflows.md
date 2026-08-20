# Agent Note: Open-source upgrades use out-of-package project workflows

Status: implemented

## Problem

AiDesktop adopts the DSH source foundation, vendored Cordis packages, released dependencies, copied source blocks, and architecture references. The adoption ledger records provenance and current scope, while DSH/Cordis update rules, Voyaseek package rescoping, product branding, verification, and desktop packaging live in separate owners. Reconstructing their order from memory makes an upstream refresh slow and risks editing foundation code where an existing plugin or deployment extension can preserve product behavior. Embedding a new updater in a runtime package would also add a product dependency on local open-source checkouts and maintenance-only code.

## Decision

The standard-library tool and its specification live in `/Users/baron/projects/开源代码/adopt-open-source`, outside every AiDesktop workspace and release family. AiDesktop keeps provenance in `.open-source/adoptions.yaml` and stores declarative project workflows in `.open-source/plugins/*.json`. A plugin identifies existing adoption rows, lists paths that must stay outside product artifacts, and orders `inspect`, `sync`, `adapt`, `brand`, `verify`, `record`, and `package` steps. Commands are argument arrays with bounded placeholders; manual steps carry current instructions. The tool validates and renders these steps but never executes them.

A plugin may also declare analysis areas that associate upstream path prefixes with current local seams, an initial `adopt`, `adapt`, `defer`, `reject`, or `review` strategy, the architectural reason, and verification entries. `analyze-upgrade` validates the checkout origin and linear commit range, assigns each changed file to the longest matching prefix, and reports file-status counts, relevant commits, local-path presence, and unmatched changes. These rules route evidence; they do not replace source and test review or make the declared strategy a final adoption decision.

The DSH workflow treats the adoption ledger as the owner of the DSH source baseline, `vendor/README.md` as the owner of Cordis versions and local divergences, `scripts/rescope-vendor.ts` as the owner of vendored package-name conversion, and `scripts/rebrand.ts` as the owner of product-brand conversion. Product behavior stays in existing packages, Cordis plugins, presets, and app assembly whenever those extension points can preserve it. Verification precedes baseline replacement. Git history owns iteration history, so the ledger keeps one current row per adoption instead of accumulating change-log copies.

Packaging remains an explicit authorization boundary. The workflow may render the existing DMG command with `requires_approval: true`, but it does not execute packaging, publication, network writes, Git writes, or artifact upload. `.open-source`, `.agents`, and the maintenance codemods remain outside npm release families, the staged runtime dependency closure, and Forge extra resources; legal attribution and generated third-party notices continue to ship through their existing product owners.

## Alternatives considered

A DSH runtime plugin was rejected because provenance review and source synchronization are maintenance operations, not model or product capabilities. A free-form Python plugin API was rejected because merely inspecting an unfamiliar business repository could execute repository code. A second brand or vendoring implementation was rejected because it would duplicate executable owners and drift. Automatic merge, patch replay, ref replacement, and packaging were rejected because source provenance, license changes, local work, and artifact creation require review or new authorization.

## Consequences

An upstream review has a machine-readable, project-specific analysis map and execution order without creating a runtime dependency. Other business projects can define their own JSON rules against the same external tool, while each project retains its existing codemods, tests, and packaging commands. Unmatched upstream changes remain visible instead of being forced into an unrelated capability. Missing checkout or target values remain visible plan inputs rather than triggering partial commands. A checkout with the wrong origin, a divergent target, an unregistered adoption ID, a path traversal, an unsupported placeholder, or an unknown plugin field fails validation.

The adoption ledger pins the DSH source to an exact upstream Git commit. Recovery evidence compares the imported AiDesktop commit with the published `0.1.0-rc.5` tree: 5,177 Git blobs are byte-identical across 5,299 shared paths, while product additions and import-time adaptations remain local differences. `upgrade-plan` and `analyze-upgrade` can therefore use the ledger ref as a resolvable base without rewriting or removing those local changes.
