# Aistaff local capability conformance

English | [中文](README.zh.md)

This package is an explicitly `test_only` complete Host composition. It provides one fixed authoritative `local_operation`, a trusted native directory-selection fixture, the Supervisor Control in-memory test provider, a canonical Material sink, and the real `LocalCapabilityCoordinator`.

The fixture absolute path is retained only in the selector's private Host state and the privileged Supervisor registration call. Renderer-safe snapshots and operation results expose only opaque grant, consent, Receipt, revision, and Material identities.

Production bundles must not depend on or mount this package.

## Model Experience

None, as this test-only local capability fixture contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the fixture does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Test-only native access** — the package uses a fixed selector and in-memory Supervisor provider and must not be mounted by a production bundle.
