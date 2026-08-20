# Agent Note: AI Staff desktop owns local model route defaults

Status: implemented

English | [中文](2026-08-15-aistaff-desktop-model-routes.zh.md)

## Problem

The standalone desktop needs a usable default model without putting a credential in the repository, generated profile, Renderer, command line, log, or packaged artifact. On macOS, Node provider requests also need to follow the effective system proxy while the bundled DSH page must keep using its direct loopback connection.

## Decision

The AI Staff desktop profile registers `google/gemini-3.6-flash` and `dashscope/qwen-plus`, with Gemini as the first-created profile default. This is an AI Staff profile decision; the shared DSH model catalog and default profile remain unchanged. The desktop migrates only its exact earlier generated empty patch and preserves every other existing user patch.

The Electron main process reads model credentials from regular, owner-only, bounded files under `~/.codex/secrets`. It accepts only the named variables and passes their values to the DSH child environment. Explicit launch environment variables take precedence. The profile stores environment variable names, never values.

The main process resolves Electron's effective proxy for both provider endpoints and converts only the same valid credential-free HTTP(S) authority to Node proxy environment variables. Explicit launch proxy variables take precedence. `127.0.0.1` and `localhost` are always present in both `NO_PROXY` spellings for Host traffic. Before Renderer navigation, the BrowserWindow independently resolves the Runtime URL and fails startup unless every proxy directive is `DIRECT`, preventing proxy fallback for the unencrypted loopback page.

## Alternatives considered

**Put the routes and default in the shared DSH catalog.** The routes are product deployment choices, so changing the shared catalog or default profile would also change non-AI Staff deployments.

**Carry credential values in the generated profile or Renderer.** That would place secrets in repository-controlled configuration, browser-visible state, or packaged artifacts instead of the bounded main-process file reader.

**Allow the loopback Runtime page to follow the system proxy.** The page uses unencrypted local HTTP, so startup instead requires a direct route and fails before navigation when Electron resolves any proxy directive.

## Consequences

The packaged product can use the local Gemini and DashScope credentials without adding a secret store or Renderer bridge. Missing local credential files do not block startup; the existing DSH credential error remains the visible failure. Domain-split PAC results, a leading `DIRECT`, SOCKS, and authenticated proxy entries are not converted and require an explicit supported launch proxy when direct Node access is unavailable. Real DSH smoke checks select both routes and record only route names and success markers.
