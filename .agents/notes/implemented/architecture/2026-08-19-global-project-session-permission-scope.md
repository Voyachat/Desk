# Agent Note: permission defaults have trusted global and project scopes

Status: implemented

English | [中文](2026-08-19-global-project-session-permission-scope.zh.md)

## Problem

Permission presets already had two unrelated lifetimes: a global default for sessions created later and durable events for the current session. The desktop UI exposed only the global value, so users could not keep one project conservative while using another default elsewhere. Storing an override in a repository file would be unsafe: an untrusted checkout could commit Full access for itself, while `AGENTS.md` and `CLAUDE.md` are model instructions rather than Host-enforced authorization.

The permission labels were also rendered from English Host names. That bypassed the client locale even though Native and Claude sessions use the same browser surfaces. Claude only distinguished Full access from every confined preset, so the three product modes did not produce three SDK permission postures.

## Decision

The trusted user settings document owns both defaults under one namespace:

```yaml
permission:
  defaultPreset: workspace-write
  workspacePresets:
    /canonical/absolute/project: read-only
```

`workspacePresets` keys are canonical absolute paths and values must be names from the configured preset table. A new unseeded session resolves the exact canonical cwd override first and the global default second, then pins `permission/preset`, `sandbox/mode`, and `approval/policy` into its log. Seeded, resumed, forked, and already pinned sessions keep their durable facts. Deleting or moving a project does not broaden access: an unmatched path falls back to the global default, while recreating the same canonical directory intentionally reuses its user-owned rule.

The browser Settings block writes the global value or the current Workspace path through revision-guarded Settings operations. Clearing a project override uses `unset`, which restores inheritance. The composer and `/permission` picker remain the current-session controls. Full access requires an explicit confirmation in every scope.

Built-in preset machine values stay stable while the client renders localized product copy at use time: `read-only` is Ask for approval, `workspace-write` is Agent approval, and `danger-full-access` is Full access. Custom preset names and descriptions remain Host-owned fallback text. Slash-command protocol names also remain stable; the command menu carries a separate localized display label.

Native and Claude sessions read the same durable permission facts. Without an explicit deployment override, Claude maps `read-only` to SDK `default`, `workspace-write + ask` to `acceptEdits`, and `danger-full-access + never` to `bypassPermissions`. This aligns interaction intent, not enforcement implementation: the Claude SDK modes do not claim the same operating-system isolation strength as the Native sandbox. Permission presets control file effects and approval prompts; network policy remains outside this capability.

## Consequences

- The priority is current-session durable facts, then a project default for future sessions, then the global default, then the deployment composition default before Settings is mounted.
- Repository content can guide a model but cannot grant execution permission. The Host never reads project instructions as authorization.
- Changing a default cannot silently widen an existing or replayed session.
- One project rule applies to Native, Claude, CLI, and any other session created with the same canonical cwd.
- A configured Claude `permissionMode` still overrides the automatic mapping and is a deployment responsibility.
- Network approval needs a separate enforcement capability before the product can promise ChatGPT-style internet controls.
