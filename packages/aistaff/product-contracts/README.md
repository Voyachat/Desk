# Aistaff product contracts

English | [中文](README.zh.md)

This package owns the JSON-compatible employee, task, approval, receipt, event, snapshot, result, and Renderer-to-Host types used by the deterministic UI acceptance fixture. Entity ids remain plain strings at runtime and carry distinct TypeScript brands so callers cannot interchange them accidentally.

## Model Experience

None, as this package exports product data contracts and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; exported types do not reach model requests at runtime.

## Known Limitations and Deferred Work

- **Fixture vocabulary only** — these task-centric types are not the Aistaff Cloud contract. Production integration uses the versioned Workforce/Engagement/Activity/Material/Interaction contract artifact through an adapter; do not add cloud revisions, grants, cursors, or execution evidence here.
