# @voyaseek-ai/dsh-aistaff-client-product

English | [中文](README.zh.md)

This browser plugin adds an **AI 员工** action to the existing sidebar footer and an additive employee workbench to the shell overlay. It does not replace the shipped sidebar, conversation, details, or settings surfaces.

The package has two explicit browser entries. `./client` is the preserved deterministic Fixture path used by the first local UI acceptance flow. `./cloud-client` is the production UI path and selects `ctx.employeeExperience`; it never detects, imports, or falls back to the Fixture port. Both register the same `sidebar.footer.action` and `shell.overlay` seats with the same visual language.

In Electron, both entries consume the preload-owned startup intent only after `conversation`, `sessions`, and `connection` are available and the selected Session is real and blank. The handoff applies the selected Agent Preset, records the confirmed preset in the Session list, and writes the text draft into that Session's conversation input without sending it. Electron is acknowledged only after every step succeeds; missing or non-blank Sessions remain pending, while any failed operation leaves the intent unacknowledged and is not retried automatically because a transport failure can have an unknown outcome. Ordinary browser deployments expose no preload bridge and perform no handoff.

The Cloud Slot Store contains only panel visibility, employee and engagement selection, the current draft, busy state, and display-safe error text. Business projection remains in `EmployeeExperienceObjectLayer`; a reference-only adapter connects its atomic `observe()` contract to React `useSyncExternalStore`. Mutations create one `OperationId`, use owner-supplied risk/revision/outcome fields unchanged, and query `readOperation` with that same id only when the owner reports `UNKNOWN_OUTCOME`.

Material text and Markdown are rendered as text without raw HTML. Structured material is rendered as inert JSON, links are display-only, and Artifact access goes through the typed preview/download callback. `local_operation` interactions remain disabled for the current `client_mode: none` flow.

## Model Experience

None, as this package renders product controls and contributes no prompt, model message, Session event, or tool schema.

#### KV Cache effect

None; the package does not assemble or send model requests.

## Known Limitations and Deferred Work

- **Cloud bundle selection** — the DSH module scanner currently discovers only a package's `./client` export. The production composition must explicitly select the built `./cloud-client` artifact; it must not rely on service probing to switch entries.
- **Generic interaction forms** — the V1 Input interaction displays one safe text value. Rich fields require an admitted schema-form renderer before the corresponding contract Feature is enabled.
- **Controlled material handoff** — the workbench requests typed access grants but a later Electron IPC handler owns actual preview/download bytes and native destination selection.
