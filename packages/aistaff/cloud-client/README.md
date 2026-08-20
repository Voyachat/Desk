# Aistaff Cloud Client

English | [中文](README.zh.md)

Host-only Client Gateway adapter for the production `EmployeeExperiencePort`. It negotiates one versioned contract selection, builds one snapshot-bound Workforce/Engagement baseline, publishes only complete Renderer-safe replacements, and resumes an at-least-once SSE stream from an opaque cursor.

The package contains no production JSON Schema, service URL, credential, token, or conformance fallback. Production assembly must inject an immutable Aistaff contract artifact codec and an authenticated transport. The transport owns URL resolution and authentication; the artifact owns request encoding, response validation, event decoding, semantic projection composition, and operation-outcome decoding.

Mutations bind body `operation_id` to `Idempotency-Key`. A dispatched timeout or `UNKNOWN_OUTCOME` is reconciled through the original operation; the adapter never invents a replacement operation id. Snapshot, stream, selection, event-envelope and cursor values remain inside the Host provider and never enter `EmployeeExperienceSnapshot`.

## Model Experience

None, as this Host adapter publishes Renderer-safe business projections and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the package does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Production artifact unavailable** — no released Aistaff Client Gateway artifact or provider conformance environment is currently available. Tests use a package-local codec and carrier; production startup requires a pinned artifact, integrity metadata, transport, protocol offer, timeouts, and an initial snapshot.
