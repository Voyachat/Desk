# Agent Note: AI Staff desktop owns local model route defaults

Status: implemented

English | [中文](2026-08-15-aistaff-desktop-model-routes.zh.md)

## Problem

The standalone desktop needs a usable default model without putting a credential in the repository, generated profile, Renderer, command line, log, or packaged artifact. On macOS, Node provider requests also need to follow the effective system proxy while the bundled DSH page must keep using its direct loopback connection.

## Decision

The AI Staff desktop profile registers `google/gemini-3.6-flash` and `dashscope/qwen-plus`, with Gemini as the first-created profile default. This is an AI Staff profile decision; the shared DSH model catalog and default profile remain unchanged. The desktop migrates only its exact earlier generated empty patch and preserves every other existing user patch.

The Electron main process reads model credentials from regular, owner-only, bounded files under `~/.codex/secrets`. It accepts only the named variables and passes their values to the DSH child environment. Explicit launch environment variables take precedence. The profile stores environment variable names, never values.

The main process resolves Electron's effective proxy for both provider endpoints and converts only the same valid credential-free HTTP(S) authority to Node proxy environment variables. Explicit launch proxy variables take precedence. `127.0.0.1` and `localhost` are always present in both `NO_PROXY` spellings for Host traffic. Before Renderer navigation, the BrowserWindow independently resolves the Runtime URL and fails startup unless every proxy directive is `DIRECT`, preventing proxy fallback for the unencrypted loopback page.

## Consequences

The packaged product can use the local Gemini and DashScope credentials without adding a secret store or Renderer bridge. Missing local credential files do not block startup; the existing DSH credential error remains the visible failure. Domain-split PAC results, a leading `DIRECT`, SOCKS, and authenticated proxy entries are not converted and require an explicit supported launch proxy when direct Node access is unavailable. Real DSH smoke checks select both routes and record only route names and success markers.
