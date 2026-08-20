# @voyaseek-ai/dsh-aistaff-client-brand

English | [中文](README.zh.md)

This package is the sole owner of Voyaseek browser-brand presentation for the Aistaff product. The Aistaff product bundle installs it after the generic DSH Web bundle, and its higher-priority occupants fill `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` without replacing the upstream slot declarations or shell components.

The Host half is an inert Loader seat. The Client half registers all three occupants as one declaration-aware set, so HMR and declaration teardown cannot leave a mixed brand.

## Model Experience

None, as the package contributes browser presentation only; nothing here enters a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Static delivery remains app-owned** — the assembled Web app serves the referenced light and dark PNG files.
- **Browser metadata is separate** — favicon and document title remain concerns of the assembled product application.
