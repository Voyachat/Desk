# Aistaff Employee Experience Remote

This package exposes the authoritative Host `ctx.employeeExperience` service through strict generated Typert codecs under the `employeeExperience` namespace. The Host snapshot method performs the service's atomic observe/read and disposes its temporary observation immediately.

The Client entry fetches and validates a complete Host baseline before registering `ctx.employeeExperience`. It owns a `loading` generation-zero object layer, accepts only monotonic complete replacements, preserves every mutation `operation_id`, refreshes after successful mutations, and keeps carrier failures distinct from display-safe `ProductError` values. Cloud cursors, snapshot leases, access tokens, and transport recovery state are absent from this package's methods.

## Model Experience

### Employee Experience Remote bridge

#### What the model sees

Nothing. The bridge carries Renderer business projection reads and explicit user operations and does not register prompts, tools, or Session events.

#### Token effect

None. No Remote payload enters model context.

#### KV Cache effect

None. The package does not alter model requests.

## Known Limitations and Deferred Work

- **No pushed replacement stream** — the Client refreshes the complete snapshot after each successful mutation. Host-owned Cloud SSE replay remains in the Cloud adapter and is never forwarded to the Renderer.
