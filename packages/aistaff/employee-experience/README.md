# Aistaff employee experience

English | [中文](README.zh.md)

This package owns the formal Renderer-safe AI employee service seam. `EmployeeExperiencePort` registers as `ctx.employeeExperience`; Cloud and local providers remain separate packages. `EmployeeExperienceObjectLayer` owns one complete employee, engagement, and currently loaded engagement projection and publishes immutable replacements through an atomic initial-read-plus-listener `observe()` call.

The package deliberately has no Cloud transport, checkpoint, authentication credential, filesystem location, execution-engine identity, or fixture dependency. Providers validate their owner wire before constructing these DTOs. The Renderer compares opaque revisions only for equality and sends the original `OperationId` while reconciling an uncertain outcome.

## Surface

```ts
import {
  EmployeeExperienceObjectLayer,
  type EmployeeExperienceSnapshot,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'

const observation = ctx.employeeExperience.observe((replacement) => {
  render(replacement)
})
render(observation.snapshot)
observation.dispose()

abstract class ProviderBase extends EmployeeExperienceObjectLayer {
  protected replace(next: EmployeeExperienceSnapshot): void {
    this.publishReplacement(next)
  }
}
```

`observe()` synchronously registers the listener and captures the matching snapshot before returning. It does not deliver the initial value through the listener. Every later notification is a complete, deeply frozen replacement with a strictly greater `view_generation`; listener failures are contained so one UI consumer cannot starve another.

## Model Experience

None, as this package holds a Renderer business projection and contributes no prompt, model message, session event, or tool schema.

#### KV Cache effect

None; no exported value reaches a model request directly.

## Known Limitations and Deferred Work

- **Provider validation is external** — the Cloud provider must validate the pinned contract artifact and remove transport recovery and authentication state before it publishes a replacement.
- **No production provider** — this package is the Service Definition and shared object layer only; a production bundle must inject an explicit Cloud or local provider and cannot fall back to a fixture.
