# @voyaseek-ai/dsh-client-ui-settings-memory

English | [中文](README.zh.md)

Shell-independent `settings.section` page for enabling, searching, inspecting, editing, deleting, and clearing structured local memory. It depends only on the stable slot: controls use `settings.*`, while entries use the dedicated loopback-only `memory.*` API, so the modal-to-full-frame Settings rewrite does not change its data contract.

The same plugin contributes low-emphasis rows to the conversation: a committed maintenance event reports created, updated, deleted, or failed extraction, while unchanged passes stay in the log without adding chat noise; a recalled-context row reports the number of items used. Both changed and recalled rows carry exact provider identities into a shared editor, so a correction replaces the selected item instead of performing a text search. The page and editor are omitted for non-loopback connections. Control writes use `expectedRevision`, entries remain when disabled, and `RiskConfirmation` protects item deletion and clear-all. The browser receives neither the SQLite path nor credentials; opening the pathless Settings document edits controls only. Pending and failed extraction counts make background maintenance visible.

## Model Experience

None, as this package renders maintenance and recall provenance already owned by the agent-memory context consumer.

#### KV Cache effect

None directly; changing or deleting entries affects only future recall decisions.

## Known Limitations and Deferred Work

- The page is intentionally absent on non-loopback connections.
- Memory data is not directly file-edited; list/delete/clear always pass through the Host provider.
