# Aistaff product bundle

English | [中文](README.zh.md)

This package is the additive Aistaff product layer over the existing DSH `base` and `web-app` bundles. It mounts the Host product projection and browser product plugin without replacing the DSH Agent Loop, sidebar, conversation, workspace, trajectory, or settings owners.

Use it as the final bundle in an AiDesktop profile. Removing this layer restores the unmodified DSH product surface.

## Model Experience

None, as this package only composes Host and Client plugins and contributes no prompt section, model message, or tool schema.

#### KV Cache effect

None; this bundle adds no model-visible data.

## Known Limitations and Deferred Work

- **Fixture composition only** — the current bundle mounts the local projection and Client surface. A production bundle must inject the Client Gateway adapter and must not silently fall back to local Task state.
