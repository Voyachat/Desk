# `@voyaseek-ai/dsh-base`

English | [中文](README.zh.md)

The shared dsh core as a profile bundle: [`cordis.patch.yml`](cordis.patch.yml) inserts every base plugin row — model adapters, the shared [`agent-default-model`](../../core/agent-default-model/README.md) selection, tools, persistence, policy, settings/credentials, telemetry, and host-level subagent providers — over the empty profile root, as the first layer of every profile's `dsh.profile.bundles` list. Codex and Claude Code providers load dormant; Agent Presets independently decide whether their agent contributes either model-facing delegation tool. Later bundle layers (e.g. [`dsh-web-app`](../web-app/README.md)) and the user's profile `cordis.patch.yml` override these rows by id; a patch replaces a row's whole `config`, so mode-specific values live in mode bundles, not here. The package has no runtime API; the profile composer resolves the patch through the `dsh.bundle.patch` manifest field, never through code.

The patch gates both shell stacks by platform on its own rows: `bash-sandbox`/`tool-bash` carry `disabled: !!js process.platform === 'win32'` (bash has no Windows runner), and their twins `pwsh-sandbox`/`tool-pwsh` mount on win32 only with the inverted expression — one shared patch file, exactly one shell stack per host. The permission surface stays exactly as on POSIX: `sandbox`/`sandbox-policy` enforce the file-effect policy through the Windows ACL restricted-token runner (the win32 chain of `dsh-sandbox-local` → `@voyaseek-ai/dsh-sandbox-windows-acl`), the permission switcher and the approval service run unchanged, and `fs-sandbox` keeps fencing `ctx.fs` writes — mounting `dsh-fs-local` alongside it would double-register `ctx.fs` and fail the load. A Windows host that prefers the unconfined local pwsh executor or full access overrides these rows through its profile or home `cordis.patch.yml` (the bash-restore recipe must be complete: disable `pwsh-sandbox`/`tool-pwsh` AND re-enable `bash-sandbox`/`tool-bash` — both executor families register the same `bash` service, so an incomplete recipe fails loud at load). POSIX hosts see the pwsh rows disabled.

The row set and its rationale are documented inline in the patch file; the [generated composition graph](../../../apps/cli/composition.md) renders it.

The base also enables the bounded local [`ctx.agentMemory`](../../memory/README.md) provider and its completed-turn capture/first-step recall consumer. The capability needs no external service or credential and remains replaceable behind its provider-neutral service.

## Bundled design skill

Every profile exposes the pinned [`design-taste-frontend`](skills/design-taste-frontend/SKILL.md) skill through the existing filesystem skill provider. It is a verbatim MIT-licensed adoption of `leonxlnx/taste-skill` at commit `dfb6f9f9e93a39f673b1827c0889cc28326d1800`; the adjacent license and [open-source adoption ledger](../../../.open-source/adoptions.yaml) preserve its source. No second skill loader or design-agent runtime is introduced.

The skill is intended for landing pages, portfolios, marketing pages, and visual redesigns. It explicitly excludes dashboards and dense product interfaces. Trusted bilingual task rules automatically inject its full body when direct user text matches a supported web-design intent; exclusions keep dashboards, admin panels, data tables, multi-step forms, editors, native mobile, and realtime collaboration out. The slash gesture and model-facing catalog remain fallback paths. Deterministic visual acceptance remains a separate workflow concern.

The same bundle probes the separately managed `prime-agent` executable without starting it. When present, the host registers the `prime-computer-use` ACP provider and the Standard, PTC, and Cordis presets expose `computer_use`; when absent, both remain out of the model's tool view. A child starts only after the model selects the task-specific tool.

## Model Experience

Indirectly, through the inserted rows: this bundle selects the shipped persona-less prompt base, tool set, and DeepSeek adapter that mode bundles specialize. It also contributes the stable `design-taste-frontend` catalog entry; the skill body becomes model-visible only when selected.

#### KV Cache effect

The stable skill catalog entry affects the initial prompt. Loading the skill body creates a task-local context change; every other inserted row's package owns its effect.

## Known Limitations and Deferred Work

- **A patch replaces whole row configs** — profile overrides must restate every field a row keeps; there is no deep-merge layer.
- **Claude's SDK platform CLI remains in the Profile install closure** — the base bundle depends on the Claude provider, whose production path resolves the host `claude`; removing the SDK's unused optional payload is deferred to the product installation-closure follow-up.
- **The Windows temp grant is a private per-session subdirectory** — `workspace-write` confines writes to the workspace plus the session's own temp subdirectory (`<temp>\dsh-<hash>`, TMP/TEMP rewritten for confined children); `read-only` grants nothing. See `@voyaseek-ai/dsh-sandbox-windows-acl`.
