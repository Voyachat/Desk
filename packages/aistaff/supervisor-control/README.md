# Aistaff Supervisor control

English | [中文](README.zh.md)

This package owns the Host-only `aidesktop.supervisor-control.v1` Service Definition. `SupervisorControlPort` registers as `ctx.aistaffSupervisorControl` and carries a Supervisor handshake, local resource Grant registration and revocation, bounded capability reads, Receipts, and idempotent operation reconciliation.

`SupervisorGrantRegister.root_path` is the only public path field and exists only on the privileged Host-to-Supervisor call. Every returned Grant, payload, Receipt, error, and operation status is path-free and carries opaque branded identities. The current Host session receives a fresh `capability_context_handle` through `hello()`; `capability_only` requests use that handle and never manufacture a local Runtime identity.

The package is a Service Definition, not a filesystem implementation or transport. A production provider must authenticate its peer, own the Grant ledger and Receipt journal, revalidate resource identity and limits immediately before a read, and contain every path-bearing failure before it reaches this port. Cloud Approval, local consent, Supervisor Grant, and DSH tool Approval remain independent decisions.

## Surface

```text
const hello = await ctx.aistaffSupervisorControl.hello()
const result = await ctx.aistaffSupervisorControl.readCapability({
  operation_id,
  execution_context: {
    kind: 'capability_only',
    capability_context_handle: hello.capability_context_handle,
  },
  subject,
  grant_handle,
  expected_grant_revision,
  intent: 'file/read_text',
  relative_segments: ['notes.txt'],
  max_bytes: 65536,
  deadline_at,
})
```

An uncertain call fails with `SupervisorControlError` code `OUTCOME_UNKNOWN`, the original `operation_id`, and a retained `receipt_ref`. The caller reconciles through `readOperation()` or `getReceipt()` and must not create a new operation identity.

## Model Experience

None, as this privileged Host control service contributes no DSH prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; a consumer owns any later admission of returned content into a model request.

## Known Limitations and Deferred Work

- **No production provider** — the package-local in-memory provider exists only for deterministic contract tests and performs no filesystem or sidecar I/O.
- **No durable Receipt journal** — cross-restart operation recovery belongs to the production Supervisor provider.
- **No device attestation** — signing and Cloud dispatch remain separate V2 work after the local control path is proven.
