# Aistaff local capability

English | [中文](README.zh.md)

This package owns the Renderer-safe local resource and consent seam. `LocalCapabilityPort` registers as `ctx.localCapability`; `LocalCapabilityObjectLayer` publishes deeply immutable complete replacements. Renderer inputs contain only opaque identities, expected revisions, and one stable `OperationId`.

The Host coordinator resolves the current `LocalOperationRequestView` from an injected authoritative source before selecting or dispatching. It never accepts an operation, arguments, risk, policy, filesystem location, Supervisor endpoint, token, or capability context from the Renderer. Native selections pass their location directly to Supervisor grant registration and publish only a display name plus opaque grant identity.

Supervisor Receipts are authoritative for settlement. Only `succeeded` registration, read, and revocation Receipts may create an active resource, publish a result, or project a revoked resource; `failed`, `rejected`, and `unknown` Receipts remain sanitized evidence and produce matching failed, rejected, or unknown operation states under the original `OperationId`.

## Model Experience

None. `capability_only` executes in the Cloud employee runtime; this package does not add DSH model messages, tools, or Session Events.

## Known limitations

Production composition must inject the authoritative Cloud interaction resolver, trusted native selector, admitted device identity, and production Supervisor Control provider. The conformance package is explicitly test-only and must not be mounted by a production bundle.
