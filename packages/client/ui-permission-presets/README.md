# @voyaseek-ai/dsh-client-ui-permission-presets

English | [中文](README.zh.md)

Permission browser surfaces for three scopes. The General-settings block reads the explicitly exposed `permission` Settings descriptor, derives its options from the host's dynamic `defaultPreset` enum, and shows both the global default and an optional override for the current Workspace path. Writes use revision-guarded `settings.mutate` operations: `defaultPreset` for the global value, `workspacePresets[canonicalPath]` for a project override, and `unset` to follow the global value again. These defaults apply only to sessions created later; they never switch an existing session. Choosing Full access requires an explicit, scope-specific risk acknowledgement before either default is written.

The current-session surface remains a popupSelect DECORATION hung on the host `/permission` command (`ctx.commandUi.decorate`). A decoration is not a second command — the host command keeps its slash-menu row, the argued path (`/permission <preset>` switches directly), and the durable lifecycle logging. Built-in presets are localized at render time as Ask for approval, Agent approval, and Full access; custom presets preserve their Host name and description. Options and the active mark read the session's `permissions` projection (the same host-computed select the composer chip renders), so both current-session surfaces share one read source and one write path. The decoration is available exactly while the projection key is present; a permission-less composition shows neither picker nor Settings block.

The `/client` exports are the plugin body (`apply`/`inject`).

## Model Experience

Indirectly, through the permission facts written by its two surfaces: the Settings row causes a future session to start with whole-value knob events (`permission/preset`, `sandbox/mode`, `approval/policy`), while the `/permission` picker appends the same facts when it switches the current session; those events select the sandbox mode and approval policy later tool calls resolve, and picker interaction adds no prompt content.

#### KV Cache effect

No direct invalidation; the knob consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **The Settings block is Web-only** — non-Web clients may still switch the current session through `/permission`, but do not receive this browser contribution.
- Permission presets control file effects and approval prompts; they do not currently control network access.
