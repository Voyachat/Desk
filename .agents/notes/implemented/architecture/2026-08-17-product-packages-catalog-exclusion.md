# Agent Note: Product packages stay out of the harness Cordis catalog

Status: implemented

## Problem

The AiStaff product import brought eleven `packages/aistaff/*` packages that merge twelve `ctx.*` services into the Cordis Context: employee experience, local capability, supervisor control and process, product projection, cloud conformance and provider, remote gateways, and a test-only conformance control. The Typert-backed Cordis catalog fail-closes both ways: every discovered service needs a `SERVICE_PAGE` partition, and every signature type needs a documentation link. Classifying the product surface into the harness documentation catalog would publish product APIs that the public harness docs do not own and regenerate those artifacts on every product change.

## Decision

`CordisCatalogPolicy.excludedPackages` names manifest packages omitted from the projection. `projectCordisCatalog` applies the same filtered package set to semantic analysis and exported-declaration indexing, so excluded services, events, signature links, and runtime type declarations cannot affect generated harness artifacts. The [repository policy](../../../../scripts/gen-cordis-catalog.ts) lists the eleven product packages and names each of their twelve Context keys in `SERVICE_WALK_EXEMPTIONS`; the independent declaration scan still reads every Context merge and therefore remains fail-closed for declared but unrendered keys. `AgentDriverFactory`, the harness-owned agent driver type, is linked to the [core subsystem page](../../../../docs/subsystems/core.md).

## Consequences

- The harness catalog documents harness APIs; product service APIs remain in their owning package READMEs under [`packages/aistaff`](../../../../packages/aistaff).
- A product package with a Cordis surface requires an exclusion entry, and each excluded Context key requires a walk exemption with its documentation owner. Harness services still require a page partition and linked signature types.
- The catalog contract suites run rather than skip, including a fixture proving that an excluded package and its same-named exported type cannot enter or suppress the runtime catalog.
- The check-mode analyzer-required annotations on `ConformanceClock.now` and `ConformanceDirectorySelector.calls` remain explicit source types.
