# Aistaff Cloud and Local Client Product

English | [中文](README.zh.md)

This package is the strict V2 production `dsh.client` entry for the Aistaff Cloud AI employee workbench with Local Capability. Its Host half is a no-op marker; `lib/client.js` registers the browser plugin under `@voyaseek-ai/dsh-aistaff-cloud-local-client-product`.

The browser source reuses only the production `apply` from `@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts`. It does not import the Fixture entry or detect services to select a product mode. Loader ordering requires API Remotes, Employee Experience Remote, Local Capability Remote, Client Runtime, layout, and sidebar modules before this wrapper. Cordis injection then requires `slots`, `employeeExperience`, and `localCapability` together, so V2 cannot register a Cloud-only workbench during startup races.

The browser build inlines the selected production source and CSS while preserving DSH platform modules as loader-table externals. CSS virtual module identities contain only the package identity and stylesheet basename. The minified browser artifact has no source map and carries no Host Supervisor, coordinator, filesystem target, path, token, or socket implementation.

## Model Experience

### Strict V2 workbench composition

#### What the model sees

Nothing directly. The wrapper only registers Renderer UI over existing Employee Experience and Local Capability projections.

#### Token effect

None. This package contributes no prompt, tool schema, or model input.

#### KV Cache effect

None. Client composition does not alter model requests.

## Known Limitations and Deferred Work

- **No Host implementation** — this package requires the existing Remote-backed `employeeExperience` and `localCapability` services and intentionally fails to register without either one.
