# Agent Note: Codex uses its bundled runtime and current model route

Status: implemented

English | [中文](2026-08-21-codex-bundled-runtime-launch.zh.md)

## Problem

The desktop Runtime installs the pinned `@openai/codex` package and its platform-specific native payload under its private `node_modules`, but the Codex driver launched the bare command `codex`. Electron does not add that private `.bin` directory to the Runtime process `PATH`, so every Codex turn could fail with `spawn codex ENOENT` even though the required binary shipped inside the application.

The turn resolver also skipped `resolveExternalRuntimeRoute` when the selected provider id matched the configured default. A settings update could retain the provider id while changing its endpoint or credential reference, leaving Codex on stale startup configuration. Separately, the alternative driver created agent-scoped dispatch from a plugin context that did not declare the `tools` service required by tool-aware agent extensions.

## Decision

The driver resolves its default executable directly from the platform optional dependency owned by the pinned `@openai/codex` package. Platform and architecture select the same six package aliases and target triples as the upstream launcher; the resulting absolute path points at `vendor/<target>/bin/codex[.exe]`. Unsupported hosts, missing optional packages, and missing native executables fail with a Codex-specific configuration error before a turn starts. A complete `argv` override remains authoritative, followed by an explicit `executable`, then the bundled native binary.

Every selected provider/model request first asks `dsh-llm` for its current Codex-compatible external Runtime route. A returned route supplies the current endpoint and credential reference even when its provider id equals the configured default. If no route exists, the configured default provider retains its static fallback, while a different provider still fails before process startup.

The Codex plugin declares `tools` as an injected peer service so agent-scoped extensions receive a context authorized to access ToolRuntime.

## Alternatives considered

- **Add the Runtime `.bin` directory to Electron's `PATH`.** This leaves launch correctness dependent on product-specific environment mutation and preserves a hidden requirement that non-desktop hosts reproduce the same path setup. The Codex package already identifies the exact native payload it owns.
- **Run the JavaScript `@openai/codex` launcher.** That adds an unnecessary wrapper process and requires selecting a Node executable in packaged environments. Resolving the native descendant keeps subprocess ownership and termination direct.
- **Require a global Codex installation.** The product already ships a pinned version. Falling back to a host command would make behavior depend on an unrelated installation and version.
- **Always require a dynamic LLM route.** Static `provider`, `baseUrl`, and `apiKeyEnv` remain a supported standalone composition. Only a selected non-default provider requires a registered dynamic route.

## Consequences

Desktop Codex turns no longer depend on inherited shell path configuration. Deployments that intentionally use another executable retain the existing overrides. A corrupt or unsupported bundled installation fails early with the missing package or executable named in the error.

Same-provider model selections use current settings metadata and credentials on the next turn. The added `tools` peer dependency makes the driver topology explicit and prevents agent-scoped tool extensions from failing with `cannot get property "tools" without inject`.

## Testing

Configuration tests resolve the installed native binary, pin platform mapping, preserve explicit argv and Windows batch handling, reject unsupported or missing payloads, and prove that a same-provider request refreshes endpoint and credential metadata. The real Cordis composition test pins the declared ToolRuntime injection while creating the Codex driver through AgentLoop.
