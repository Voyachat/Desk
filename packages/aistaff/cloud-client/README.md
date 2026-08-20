# Aistaff Cloud Client

English | [中文](README.zh.md)

Host-only Client Gateway adapter for the production `EmployeeExperiencePort`. It negotiates one versioned contract selection, builds one snapshot-bound Workforce/Engagement baseline, publishes only complete Renderer-safe replacements, and resumes an at-least-once SSE stream from an opaque cursor.

The package contains no production JSON Schema, service URL, credential, token, or conformance fallback. Production assembly must inject an immutable Aistaff contract artifact codec and an authenticated transport. The transport owns URL resolution and authentication; the artifact owns request encoding, response validation, event decoding, semantic projection composition, and operation-outcome decoding.

Mutations bind body `operation_id` to `Idempotency-Key`. A dispatched timeout or `UNKNOWN_OUTCOME` is reconciled through the original operation; the adapter never invents a replacement operation id. Snapshot, stream, selection, event-envelope and cursor values remain inside the Host provider and never enter `EmployeeExperienceSnapshot`.

## Model Experience

This package does not add model input, tool schemas, tokens, or KV-cache content. It only supplies Renderer-visible product state and user operations.

## Known Limitations and Deferred Work

No released Aistaff Client Gateway artifact or provider conformance environment is currently available. Tests inject a package-local conformance codec and carrier only; production composition must fail to load until a pinned artifact version, integrity, root hash, explicit transport, protocol offer, timeout, and initial object-layer snapshot are supplied.
