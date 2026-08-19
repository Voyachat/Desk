# Prime Agent computer-use child

English | [中文](README.zh.md)

DSH automatically exposes semantic desktop control through a separately installed Prime Agent `v0.7.3` ACP child. The child loads `@injaneity/pi-computer-use@0.5.0`; DSH reuses its existing ACP subprocess provider and does not import Pi's agent loop, extension API, native helpers, or installation scripts.

## Prerequisites

Install the pinned Prime Agent release through its reviewed official distribution, then explicitly install the pinned extension:

```sh
prime-agent package install npm:@injaneity/pi-computer-use@0.5.0
```

The extension's installation may download or compile a native helper, register a macOS app, create local signing material, and request Accessibility and Screen Recording permissions. Perform that installation outside DSH under normal software-distribution review. Do not grant these permissions to an untrusted binary or user account.

## Automatic registration

At startup, the base composition asks the configured subprocess provider to resolve `prime-agent`. When the executable is available, DSH registers the `prime-computer-use` provider; the Standard, PTC, and Cordis presets then expose `computer_use` automatically. When it is absent, the provider and tool are both omitted, so ordinary sessions do not receive a broken schema. No per-task switch, overlay, slash command, or restart-time environment flag is required.

The tool description tells the model to select `computer_use` only for tasks that need observation or interaction with installed GUI applications. Each call starts a fresh Prime Agent ACP child in the current workspace. The child receives only the standalone delegated task, not the parent conversation, and returns only its final assistant text. Prime Agent keeps its own session and tool trace. A task that uses only files, shell commands, or web APIs does not start the child.

The shipped configuration deliberately enables Pi's strict background mode, disables browser control and the cursor overlay, removes Prime Agent's built-in tools, and allowlists only the state-scoped desktop operations. The ACP bridge rejects permission prompts. These settings reduce the execution surface but do not provide an application allowlist or an operating-system sandbox.

## Verify

Use a non-sensitive application and an isolated test account:

1. Start a Standard, PTC, or Cordis session and confirm `computer_use` appears without a patch when `prime-agent` is on `PATH`.
2. Ask DSH to list visible application roots without naming a tool; confirm it selects `computer_use` without acting.
3. Ask it to observe one test window and report a named control.
4. Ask it to change a disposable field through a semantic action, then verify the successor state.
5. Confirm the child exits after returning and that no browser, shell, filesystem, or package-management tool appeared in its trace.

Do not use this reference against password managers, keychains, security settings, administrator prompts, financial systems, production consoles, or regulated data. A production rollout still requires a signed helper, application/window allowlists, protocol authentication and frame limits, screenshot retention policy, DLP, and approval for effectful actions.
