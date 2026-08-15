# Aistaff product projection

This package provides `ctx.aistaffProduct`, the replaceable in-memory Host implementation of the UI acceptance fixture port. Its required `employees` configuration records an explicit initial catalog. Each accepted command appends one complete event before publishing it, and `projectProductEvents()` reconstructs the same snapshot from event history.

## Model Experience

None. The projection is a Host product service and contributes no prompt section, model message, or tool schema.

#### KV Cache effect

None; projection values do not enter a model request.

## Known Limitations and Deferred Work

- **Process-memory fixture only** — restart persistence, Cloud synchronization, and real task execution are intentionally absent; production composition must inject the Cloud adapter and must not silently fall back to this provider.
