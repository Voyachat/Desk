# Aistaff Employee Experience Remote

English | [中文](README.zh.md)

This package exposes the authoritative Host `ctx.employeeExperience` service through strict generated Typert codecs under the `employeeExperience` namespace. The Host snapshot method performs the service's atomic observe/read and disposes its temporary observation immediately.

The Client entry fetches and validates a complete Host baseline before registering `ctx.employeeExperience`. It owns a `loading` generation-zero object layer, accepts only monotonic complete replacements, preserves every mutation `operation_id`, refreshes after successful mutations, and keeps carrier failures distinct from display-safe `ProductError` values. Cloud cursors, snapshot leases, access tokens, and transport recovery state are absent from this package's methods.

## Model Experience

None, as this Renderer bridge carries business projections and user operations without registering model input.

#### KV Cache effect

None; the bridge does not assemble or send model requests.

## Known Limitations and Deferred Work

- **No pushed replacement stream** — the Client refreshes the complete snapshot after each successful mutation. Host-owned Cloud SSE replay remains in the Cloud adapter and is never forwarded to the Renderer.
