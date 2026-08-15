# Aistaff Cloud Provider

Production Host composition for `CloudClientGatewayAdapter`. An upstream owner must first register `AistaffClientGatewayInputs` with an admitted immutable contract artifact, an authenticated transport, and the semantic Client Hello. The provider has no default origin, credential, protocol offer, timeout, paging size, selection skew, or reconnect interval.

Startup fails with `CLIENT_GATEWAY_UNAVAILABLE` before publishing `employeeExperience` when inputs are absent or the initial full projection cannot synchronize. After synchronization succeeds, the plugin publishes the adapter and runs one lifecycle-owned SSE reconnect loop. Disposal aborts and joins that loop before the service is removed.

## Model Experience

This composition adds no model input, tool schema, tokens, or KV-cache content.

## Known Limitations and Deferred Work

Production assembly remains intentionally unavailable until Aistaff releases the pinned Client Gateway artifact and an authenticated transport owner supplies `AistaffClientGatewayInputs`.
