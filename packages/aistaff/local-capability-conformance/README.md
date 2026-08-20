# Aistaff local capability conformance

English | [中文](README.zh.md)

This package is an explicitly `test_only` complete Host composition. It provides one fixed authoritative `local_operation`, a trusted native directory-selection fixture, the Supervisor Control in-memory test provider, a canonical Material sink, and the real `LocalCapabilityCoordinator`.

The fixture absolute path is retained only in the selector's private Host state and the privileged Supervisor registration call. Renderer-safe snapshots and operation results expose only opaque grant, consent, Receipt, revision, and Material identities.

Production bundles must not depend on or mount this package.
