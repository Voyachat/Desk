# Aistaff product contracts

English | [中文](README.zh.md)

This package owns the JSON-compatible employee, task, approval, receipt, event, snapshot, result, and Renderer-to-Host types used by the deterministic UI acceptance fixture. Entity ids remain plain strings at runtime and carry distinct TypeScript brands so callers cannot interchange them accidentally.

## Model Experience

None. The package contributes no prompt section, model message, or tool schema.

#### KV Cache effect

None; no exported value reaches a model request.

## Known Limitations and Deferred Work

- **Fixture vocabulary only** — these task-centric types are not the Aistaff Cloud contract. Production integration uses the versioned Workforce/Engagement/Activity/Material/Interaction contract artifact through an adapter; do not add cloud revisions, grants, cursors, or execution evidence here.
