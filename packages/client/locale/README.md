# @deepseek-ai/dsh-client-locale

English | [中文](README.zh.md)

Product locale plugin: the `zh`/`en` preference is stored as `locale.preference` in `$DSH_HOME/settings.yaml` and drives both browser copy and model-visible language guidance. When no Host value exists, a fresh browser provisionally selects the first supported primary language requested by `navigator`, falling back to `zh`, and a writable loopback settings scope persists that resolved choice so Host and browser consumers converge. Host reads remain nonblocking; an accepted explicit value replaces the provisional browser value live. Remote browsers retain only a process-local selection because the settings API is loopback-only. `locale/change` fires on switches.

`LocaleRuntime` owns the ns×locale dictionary registry (typed `register(ns, {zh, en})` checked against `LocaleNamespaceMap`, `bind(ns)`→`TranslateNS<ns>`; lookup chain ns → common → zh → key), implements the slot system's `LocaleFace`, and installs itself through `ctx.slots.installLocale`, backing the framework-injected `t` standard seat (`Translate`/`TranslateNS` are ui-slots types; import them from there — this package only re-exports for dictionary owners' convenience). The [product-locale Agent Note](../../../.agents/notes/implemented/architecture/2026-08-15-product-locale-model-context.md) owns propagation into model requests; the [Host-backed preferences decision](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md) owns the persistence boundary.

## Model Experience

### Preferred reply and deliverable language

#### What the model sees

One `user:locale` contribution in the current runtime-context snapshot. The current request may override the preference for the reply or deliverable it identifies; editing preserves existing content unless the user requests translation.

##### Simplified Chinese

```markdown
User language preference: Simplified Chinese (BCP 47: zh-Hans). Use Simplified Chinese by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. Preserve existing content's language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. When generating HTML in this preferred language, set the document language to "zh-Hans".
```

##### English

```markdown
User language preference: English (BCP 47: en). Use English by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. Preserve existing content's language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. When generating HTML in this preferred language, set the document language to "en".
```

#### Token effect

The first request in a session adds one durable context snapshot. A preference change adds one replacement snapshot on that session's next request; unchanged requests add no locale tokens.

#### KV Cache effect

The stable system prompt remains byte-identical. A changed locale snapshot is appended after retained history, preserving the prior reusable prefix; subsequent unchanged requests reuse the retained snapshot.

## Known Limitations and Deferred Work

- **Some surfaces keep inline copy** — Settings rows, the sidebar, question composer, and model select use locale seats; other packages still own static text directly.
- **Registry-held text reads its translation once** — copy captured at registration time outside the slot render path (e.g. the `/model` command description in the command registry) keeps the language it was registered under until re-registration; slot-rendered copy follows switches live.
- **Direct remote Web cannot persist the product preference** — a non-loopback browser can switch its UI in process, but the Host model context continues to use the Host setting until a trusted remote settings-write policy exists.
