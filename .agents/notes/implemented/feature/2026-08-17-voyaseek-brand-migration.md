# Agent Note: Voyaseek brand migration keeps ecosystem identifiers untouched

Status: implemented

English | [中文](2026-08-17-voyaseek-brand-migration.zh.md)

## Problem

The desktop client ships to external customers under the Voyaseek brand, but every customer-visible surface carried the upstream identity: window and document titles, the PWA manifest, favicon, sidebar wordmark, hero mark, the first-run notice, Electron app and DMG names, error dialogs, and the model-facing system prompt. A naive global rename of "DeepSeek" would also rewrite the identifiers third-party DSH plugins rely on — `@deepseek-ai/*` package names, `DSH_HOME` layout, `__DSH_BOOT__`, the `dsh` CLI, and session-log event names — breaking plugin resolution and persistence. Separately, MIT requires the upstream copyright and license text to travel with any redistribution, without requiring the upstream brand in the product UI.

## Decision

Product identity and compatibility identifiers are split by layer. Customer-visible surfaces rebrand to Voyaseek: the web shell title, manifest, and favicon; `BrandWordmark` and `FishLogo` (export names kept, art replaced with themed raster assets served from the web shell); the hero slogan (fixed bilingual pair, Chinese line above the English line, both locales); the first-run welcome copy (version bumped so every user re-acknowledges); Electron `name`, `executableName`, error dialogs, and a Help menu opening the bundled legal texts; and `appBundleId` (`ai.voyaseek.desktop`). Compatibility identifiers stay byte-identical.

Agent identity moves at the deployment layer, never in DSH core packages. The aistaff product-bundle patch sets `includeHarnessIdentity: false` plus a Voyaseek persona on `system-prompt`, and disables `web-runtime.surfaceContext` because the upstream Web-surface orientation names the upstream product and addresses Harness developers, while `printUrl` stays on for the Electron readiness line. The shipped `standard`, `code`, and `cordis` preset personas open with the Voyaseek identity; the `dsh-persona` preset section shadows the deployment persona, so both paths present the same brand. Core packages remain unchanged, keeping upstream merges and third-party plugin expectations clean.

MIT attribution travels with the distributed artifact instead of the UI: Forge `extraResource` ships `legal/USER_AGREEMENT.zh-CN.md` — DSH appears only in its open-source section — together with `legal/third-party/deepseek-harness/LICENSE`, a verbatim copy of the root MIT text the agreement links by relative path, alongside the existing `THIRD_PARTY_NOTICES.md`.

## Alternatives considered

Renaming the `@deepseek-ai` scope or `DSH_HOME` was rejected because third-party plugins resolve packages and persist state through those identifiers. Editing the harness identity sentence or the Web-surface prompt inside core packages was rejected because the same behavior is reachable through deployment configuration, and forking core text costs every upstream merge. Keeping the DeepSeek slogan or wordmark in any theme was rejected because they are the strongest upstream brand marks in the GUI.

## Consequences

A packaged client presents Voyaseek end to end while any `dsh-plugin`-topic plugin installs and runs unchanged. The bundle-id change resets macOS app data for pre-existing internal installs, which pre-release distribution accepts. Vendor names that are functional data — the DeepSeek provider row in Models settings, DashScope, Google — are kept. Developer-facing surfaces outside the packaged client (repo docs, demo fixtures, `dsh` CLI help) still name the upstream project by design.
