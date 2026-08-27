# Agent Note: Codex driver scopes declare the tool registry used by prompt assembly

Status: implemented

English | [中文](2026-08-21-codex-agent-tools-injection.zh.md)

## Problem

Every admitted model in Code Mode failed before the Codex app-server process started with `cannot get property "tools" without inject`. The shared system-prompt assembly receives the active agent and may read `agent.ctx.tools`; `codex-agent` neither declared `tools` in its plugin inject list nor included it in the context captured for each `CodexAgent`. Cordis therefore rejected the property access at the service proxy. Because the failure happened during common prompt assembly, changing the selected model, provider route, or Codex process configuration could not repair it.

## Decision

`@voyaseek-ai/dsh-codex-agent` declares `tools` as a required service and captures its driver context through `ctx.inject(['sessions', 'agents', 'tools'], ...)`. Every `CodexAgent` is constructed with that injected context, so system-prompt contributors see the same agent-scoped tool registry for every model admitted by the runtime.

The composition regression test mounts the real system-prompt and tool services, configures two admitted models, creates one Codex agent for each model, and drives both through prompt assembly. An `agent/pre-step` rejection stops the turn before any Codex subprocess or provider request, while the prompt section proves `agent.ctx.tools` is readable and records the selected model. The test therefore covers the shared failure point without spending credentials or treating a mock provider response as runtime evidence.

## Alternatives considered

**Patch the Aistaff product composition.** Rejected because the missing declaration is inside the context `codex-agent` constructs for its driver. A product row can supply a service but cannot add an inject declaration to another plugin's already-created context.

**Special-case prompt contributors so they do not read `agent.ctx.tools` for Codex.** Rejected because the tool registry is a valid agent-scoped prompt input and other contributors may require it. Hiding the access would preserve an incomplete driver context and make behavior depend on which prompt sections happen to be installed.

**Switch configuration per model.** Rejected because all admitted models traverse the same prompt assembly before the process command is resolved. Duplicating provider or model configuration would not change the missing Cordis injection.

## Consequences

The Codex runtime now has an explicit load-time dependency on `@voyaseek-ai/dsh-tools`; a composition that omits it fails during plugin resolution instead of during the first turn. All configured Codex models share the corrected prompt context and continue to use their selected provider/model route. The regression evidence ends before a real app-server request, so provider authentication and remote model acceptance remain separate end-to-end evidence.
