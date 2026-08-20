# Aistaff Cloud Provider

English | [中文](README.zh.md)

Production Host composition for `CloudClientGatewayAdapter`. An upstream owner must first register `AistaffClientGatewayInputs` with an admitted immutable contract artifact, an authenticated transport, and the semantic Client Hello. The provider has no default origin, credential, protocol offer, timeout, paging size, selection skew, or reconnect interval.

Startup fails with `CLIENT_GATEWAY_UNAVAILABLE` before publishing `employeeExperience` when inputs are absent or the initial full projection cannot synchronize. After synchronization succeeds, the plugin publishes the adapter and runs one lifecycle-owned SSE reconnect loop. Disposal aborts and joins that loop before the service is removed.

## Model Experience

None, as this Host provider publishes an Employee Experience adapter and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the provider does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Deployment inputs unavailable** — production assembly remains unavailable until a pinned Client Gateway artifact and an authenticated transport owner supply `AistaffClientGatewayInputs`.
