# Aistaff Cloud Local Conformance Bundle

This package is a `test_only` deterministic composition for the Cloud-owned `local_read` acceptance path. It mounts Cloud conformance inputs, the production Cloud provider, the Cloud local conformance bridge, both Renderer Remotes, and the strict Cloud plus Local Capability client wrapper in dependency order.

The Cloud local conformance bridge uses the in-memory Supervisor from `@voyaseek-ai/dsh-aistaff-supervisor-control/testing`. It does not launch or validate the Rust sidecar. The current real Rust production provider keeps file read and directory listing disabled, so this bundle must never appear in a production profile or be treated as evidence that production local reads are enabled.

The browser scaffold collects both Remote client modules through the complete dependency list. No production bundle, `supervisor-process`, Fixture client entry, or automatic service fallback belongs in this composition.
