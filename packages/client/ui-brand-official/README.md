# @voyaseek-ai/dsh-client-ui-brand-official

English | [中文](README.zh.md)

This optional generic package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the upstream official DSH artwork only when `DSH_CLIENT_BUILD_PROFILE` is `official`. Product distributions may shadow these occupants with a lower numeric priority from a product-owned Client plugin.

The three occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The package therefore works whether its row activates before or after the sidebar and conversation declarers, withdraws all occupants when either declaration collapses, and leaves no partial brand mix during HMR.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package supplies the upstream occupant set** — product branding belongs in a product-owned Cordis package occupying the same slots with explicit priority.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.
