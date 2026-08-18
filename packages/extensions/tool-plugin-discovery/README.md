# @voyaseek-ai/dsh-tool-plugin-discovery

English | [中文](README.zh.md)

The read-only `find_dsh_plugin` tool searches the machine-readable [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog. The package is adapted from `dsh-find-plugin` at commit `e75dc2ee10567789a5273e13ee8db62ae285a725`; this implementation keeps curated discovery and deliberately omits the upstream live GitHub tier and executable install commands until the CLI can pin and audit every source.

Catalog fields are validated before use. One validated catalog is cached per plugin instance for `cacheTtlMs`; a failed refresh fails the call instead of treating stale or malformed data as current. Every result carries `reviewStatus: "unreviewed"` because catalog inclusion is not a security review.

| Config | Default | Meaning |
|---|---:|---|
| `catalogUrl` | `https://awesome-dsh-plugin.com/plugins.json` | Machine-readable curated catalog. |
| `requestTimeoutMs` | `10000` | Cooperative request timeout. |
| `cacheTtlMs` | `3600000` | Validated in-memory catalog lifetime. |

## Model Experience

### Tool schema and results

#### What the model sees

The model sees `find_dsh_plugin(query, limit?, language?)`. Results contain source metadata and an optional package specification, always marked `unreviewed`; the rendered result states that source inspection, the DSH plugin audit, and user confirmation are required before installation.

#### Token effect

Fixed schema cost while the tool is visible, plus data-dependent result text for each call.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged. Each result is appended after the reusable prefix.

## Known Limitations and Deferred Work

- **No offline snapshot** — catalog discovery requires the configured endpoint; the package does not copy the upstream 87 KB snapshot into every build.
- **Curated entries are not audited** — source pinning, archive inspection, dependency analysis, and installation approval belong to the CLI install gate.
- **No community GitHub tier** — repositories outside the curated catalog are omitted until rate limiting and exact-commit review can be enforced together.
