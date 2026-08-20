# Agent Note: Aistaff Cloud conformance keeps production inputs explicit

Status: implemented

English | [中文](2026-08-15-aistaff-cloud-conformance-mainline.zh.md)

## Problem

The local Aistaff source does not publish a Client Gateway contract artifact, authenticated Client endpoint, replayable employee projection, or retained operation-outcome API. Its internal Session, Run, Human Workbench, and Deliverable types are not Renderer contracts. Reusing those types would bind the desktop product to service internals and could report behavior that no published endpoint supports.

## Decision

The Host owns a `CloudClientGatewayAdapter` whose immutable contract artifact, authenticated transport, and semantic Client Hello are required injected inputs. Production composition publishes `EmployeeExperiencePort` only after protocol selection and a complete projection baseline succeed. Missing inputs or failed initial synchronization return `CLIENT_GATEWAY_UNAVAILABLE`; production has no Fixture fallback.

The Renderer consumes only complete `EmployeeExperienceSnapshot` replacements and opaque branded references through `EmployeeExperiencePort`. Cloud cursors, selection leases, credentials, transport headers, and recovery state remain in the Host. Mutations create one operation identity and reconcile uncertain outcomes with that same identity.

Until Aistaff publishes the production artifact and endpoint, one separately named conformance package supplies a fixed-root-hash `test_only` artifact and in-memory transport. Only the conformance bundle may load it. The production bundle excludes the conformance provider and the earlier product Fixture packages.

The Cloud browser entry is explicit. DSH's default Client module discovery must not select the Fixture entry when the production or conformance bundle requests the Cloud UI.

## Alternatives considered

Reusing Aistaff internal DTOs was rejected because no published Client endpoint owns their desktop behavior. Embedding a production-like handwritten Schema was rejected because it would become a second contract source. Loading the existing Fixture product bundle as a fallback was rejected because it would report local test state as Cloud state.

## Consequences

The complete browser flow and reconnect behavior can be exercised through the same adapter, Remote, object layer, and UI that production will use. This is conformance evidence, not evidence of a live Aistaff deployment. Production remains unavailable until a pinned artifact, authenticated transport owner, and identity configuration are supplied without changing the Renderer product interface.
