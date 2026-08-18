# Aistaff Supervisor process

This Host-only package starts the packaged `aistaff-desktop-supervisor` Rust binary, generates a fresh per-launch authentication token, and carries bounded JSONL requests over the child's standard input and output. The Host writes the token once as a bootstrap line on the inherited standard-input pipe before the first JSONL frame; it never enters argv, the child environment, a returned value, or a log.

The transport admits only `hello`, `health`, `shutdown`, the `control.hello`, `control.grant.register`, `control.grant.revoke`, `control.capability.read`, `control.receipt.get`, and `control.operation.read` control plane, plus the retained legacy local-file commands used below that process boundary. Process, browser, workspace write, message-cache, and MCP commands are rejected before a frame is written. Requests and responses are limited to 64 KiB, matched by exact request identity, and failed closed on timeout, EOF, invalid UTF-8, malformed JSON, protocol drift, or an unmatched response.

`apply()` authenticates `hello` before publishing `ctx.aistaffSupervisorProcess`. Its Cordis effect disposer sends authenticated `shutdown`, forces termination after the configured bound, and joins the child. Errors contain only stable Host and Rust reason codes, never payloads, paths, child stderr, or environment values.

This package is the process transport below `@voyaseek-ai/dsh-aistaff-supervisor-control-process`; it does not implement the `SupervisorControlPort` Service Definition or choose between the control and retained legacy commands. The process-backed provider uses only the `control.*` operations and never adapts a legacy result into a Receipt or execution identity.

## Model Experience

### Supervisor sidecar transport

#### What the model sees

Nothing directly. A Consumer must log data returned through `SupervisorProcessService` in the owning DSH Session before including it in a model request.

#### Token effect

None. This package contributes no prompt or tool schema.

#### KV Cache effect

None. Starting or invoking the Host sidecar does not alter model requests.

## Known Limitations and Deferred Work

- **No control semantics in this transport** — `@voyaseek-ai/dsh-aistaff-supervisor-control-process` owns the strict public request and response mapping, capability-only restriction, and reconciliation error behavior.
