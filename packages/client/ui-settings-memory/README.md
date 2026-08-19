# @voyaseek-ai/dsh-client-ui-settings-memory

English | [中文](README.zh.md)

Shell-independent `settings.section` page for enabling, searching, inspecting, deleting, clearing, and opening the bounded local memory document. It depends only on the stable slot and loopback Settings APIs, so the modal-to-full-frame Settings rewrite does not change its data contract.

The page is omitted for non-loopback connections. Writes use `expectedRevision`, react to `settings/document-updated`, preserve entries when disabled, and require `RiskConfirmation` before item deletion or clear-all. It receives no Host path; the pathless `settings.openDocument` operation asks the Host to open its own settings document.

## Model Experience

None, as this package renders a browser settings page; the agent-memory context consumer owns every model-visible recall message.

#### KV Cache effect

None directly; changing or deleting entries affects only future recall decisions.

## Known Limitations and Deferred Work

- The page is intentionally absent on non-loopback connections.
- Opening the memory file opens the shared Settings document because the bounded provider owns one namespace within it.
