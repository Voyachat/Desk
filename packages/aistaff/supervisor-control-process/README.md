# Aistaff Supervisor control process provider

This Host-only package implements `SupervisorControlPort` over the authenticated `SupervisorProcessService`. It performs `control.hello` before publishing `ctx.aistaffSupervisorControl`, requires `aidesktop.supervisor-control.v1`, validates the advertised limits and exact `file/read_text` and `directory/list` capabilities, and fails plugin loading when the Rust process is incompatible.

Grant registration, Grant revocation, bounded reads, Receipt lookup, and operation reconciliation map directly to `control.grant.register`, `control.grant.revoke`, `control.capability.read`, `control.receipt.get`, and `control.operation.read`. The provider validates every request and response, decodes Rust `bytes_base64` into `Uint8Array`, preserves branded values as their original JSON strings, and never creates a Receipt or replacement operation identity in TypeScript.

Only `SupervisorGrantRegister.root_path` crosses the privileged Host-to-Supervisor call. Returned control metadata and fixed errors contain no path, URL, authentication token, process endpoint, or child diagnostic; requested file bytes remain the selected user content. A timed-out operation returns `OUTCOME_UNKNOWN` with the original `operation_id`; callers reconcile that identity instead of retrying under a new one. `managed_runtime` is rejected because this provider implements only the current Host-session `capability_only` execution context.

## Model Experience

### Supervisor process adapter

#### What the model sees

Nothing directly. A Consumer must log content returned by `SupervisorControlPort` in the owning DSH Session before a later model request can include it.

#### Token effect

None. This provider contributes no prompt, tool schema, or Session event.

#### KV Cache effect

None. Control calls do not alter model requests.

## Known Limitations and Deferred Work

- **External Cloud admission remains required** — this provider proves and executes only the local Supervisor decision; it does not supply Cloud Approval, device attestation, artifact admission, Receipt acknowledgement, or Cloud reconciliation, and it is not sufficient by itself to enable a production desktop profile.
