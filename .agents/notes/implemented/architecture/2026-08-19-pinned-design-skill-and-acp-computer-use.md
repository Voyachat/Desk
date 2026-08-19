# Agent Note: pinned design guidance and computer use stay at plugin boundaries

Status: implemented

English | [中文](2026-08-19-pinned-design-skill-and-acp-computer-use.zh.md)

## Problem

Web-design tasks need a repeatable visual method, while desktop automation needs access to native accessibility and screen-capture facilities. Reimplementing either capability inside DSH would duplicate a skill loader, an agent loop, native helpers, and their upgrade burden. Importing the reviewed upstream runtimes into the main process would also expand the trusted dependency and permission surface for every employee profile.

## Decision

The base bundle ships the exact MIT-licensed `design-taste-frontend` skill from `leonxlnx/taste-skill` at commit `dfb6f9f9e93a39f673b1827c0889cc28326d1800`. The existing `skill-filesystem` provider resolves the bundle-owned `skills` directory from the installed `@voyaseek-ai/dsh-base` package. Trusted bilingual include/exclude rules on the existing `tool-skill` consumer automatically inject the body for direct landing-page, marketing-page, portfolio, web-design, and visual-redesign requests. The durable invocation source records `trigger: automatic`; injected or tool-produced text cannot trigger it. Explicit slash invocation and the model-facing catalog remain fallback paths. No new skill provider or design-agent runtime is added.

Desktop automation remains an external capability with automatic availability. At host load, `dsh-subagent-acp` asks the existing subprocess provider to resolve the managed Prime Agent `v0.7.3` executable. A successful probe registers `prime-computer-use`; a failed probe registers nothing, and the lifecycle-bound `computer_use` tool therefore stays absent. Standard, PTC, and Cordis presets contribute that task-specific tool without a user switch. A call starts a fresh ACP child and loads `@injaneity/pi-computer-use@0.5.0`. DSH does not import Prime Agent, Pi's extension API, its native helpers, or its installer. The child removes Prime built-in tools and enables only Pi's state-scoped desktop operations in headless mode with browser control and cursor overlays disabled.

The skill source, both external dependency decisions, reviewed upstream versions, local paths, and update policies are recorded in `.open-source/adoptions.yaml`. No agent-loop or session-format change is required.

## Consequences

- Frontend design guidance is available out of the box without a second loading path; trusted task rules inject it before the model acts, while explicit and model-selected invocation remain fallbacks.
- The computer-use process can be installed, upgraded, disabled, audited, or replaced independently of DSH.
- The ACP child receives only the delegated task and returns final assistant text; its detailed session and tool trace remain owned by Prime Agent.
- Automatic computer-use registration is not a production security boundary. Signed helpers, application and window allowlists, protocol authentication and frame limits, screenshot retention policy, DLP, and effect approval remain deployment prerequisites.

## Alternatives considered

Copying Prime Agent's loop or Pi's native implementation into DSH was rejected because DSH already owns agent, session, subprocess, permission, and subagent capabilities. Importing VoltAgent was rejected because its workflow, agent, provider, and telemetry runtime duplicates existing DSH seams. OpenCut is not adopted because its current rewrite does not yet provide a stable editor, plugin, MCP, or headless API. TencentDB Agent Memory remains a future native memory provider rather than a proxy integration because its current gateway defaults, identity isolation, deletion authorization, and write idempotency do not meet the employee-agent rollout requirements. Buzz remains an external ACP collaboration product if that product surface is later required, not a source dependency of the personal agent.
