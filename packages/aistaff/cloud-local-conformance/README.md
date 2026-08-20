# Aistaff Cloud Local Conformance

English | [中文](README.zh.md)

Test-only Host composition for the explicit `local_read` scenario in `@voyaseek-ai/dsh-aistaff-cloud-conformance`. It mounts a fixed native directory selector, the Supervisor in-memory provider, and `LocalCapabilityCoordinator`. The result sink publishes bounded directory or text output back through the same authoritative Cloud fixture, which owns the canonical Material, Cloud Receipt, completed Activity, interaction removal, and replayable SSE events.

The native fixture path remains private to the selector and Supervisor. Renderer projections and event frames contain only resource display labels, opaque handles, canonical Material identities, and path-free result content. Production bundles must not depend on this package.

## Model Experience

None, as this test-only fixture publishes Renderer-safe state and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the fixture does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Test-only native access** — the package uses a fixed fixture path and in-memory Supervisor provider and must not be mounted by a production bundle.
