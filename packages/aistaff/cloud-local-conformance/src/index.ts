/** Test-only Host composition for Cloud-owned local-read interactions. */

import { Context } from '@voyaseek-ai/cordis'
import {
  AISTAFF_CLOUD_CONFORMANCE_CONTROL_KEY,
  type AistaffCloudConformanceControl,
  type ConformanceLocalResultPayload,
} from '@voyaseek-ai/dsh-aistaff-cloud-conformance'
import type { InteractionRef } from '@voyaseek-ai/dsh-aistaff-employee-experience/types'
import { LocalCapabilityCoordinator } from '@voyaseek-ai/dsh-aistaff-local-capability'
import type {
  AuthoritativeLocalOperation,
  HostDirectorySelection,
  HostDirectorySelectionInput,
  HostDirectorySelector,
  LocalCapabilityResultInput,
  LocalCapabilityResultPublication,
  LocalCapabilityResultSink,
  LocalOperationInteractionResolver,
} from '@voyaseek-ai/dsh-aistaff-local-capability'
import {
  SupervisorDeviceSessionId,
  SupervisorDshSessionId,
  SupervisorRunId,
  SupervisorStepId,
  SupervisorTenantId,
} from '@voyaseek-ai/dsh-aistaff-supervisor-control'
import type {
  ReadCapabilityPayload,
  SupervisorSubjectBinding,
} from '@voyaseek-ai/dsh-aistaff-supervisor-control/types'
import { InMemorySupervisorControl } from '@voyaseek-ai/dsh-aistaff-supervisor-control/testing'

/** Immutable marker preventing accidental production composition. */
export const CLOUD_LOCAL_CONFORMANCE_PROVENANCE = Object.freeze({
  test_only: true,
  fixture_version: 'aistaff-cloud-local-conformance.v1',
  root_hash: 'sha256:809485b24c96a547c4c15fce8770d4aad81c4c6e5b39dc57e56f5d8420d45dd3',
})

/** Cordis plugin name. */
export const name = 'aistaff-cloud-local-conformance'

/** Current Cloud conformance owner must exist before this Host composition. */
export const inject = [AISTAFF_CLOUD_CONFORMANCE_CONTROL_KEY]

class CloudInteractionResolver implements LocalOperationInteractionResolver {
  constructor(private readonly control: AistaffCloudConformanceControl) {}

  /** @inheritdoc */
  resolve(interactionRef: InteractionRef): Promise<AuthoritativeLocalOperation | null> {
    const request = this.control.resolveCurrentLocalOperation(interactionRef)
    return Promise.resolve(request === null ? null : { request, subject: managedSubject() })
  }
}

class FixedNativeDirectorySelector implements HostDirectorySelector {
  private readonly selectedRoot = '/fixture/customer-documents'

  /** @inheritdoc */
  selectDirectory(_input: HostDirectorySelectionInput): Promise<HostDirectorySelection> {
    return Promise.resolve({ root_path: this.selectedRoot, display_name: '客户资料' })
  }
}

/** Result sink that publishes Supervisor output through the authoritative Cloud fixture owner. */
export class CloudConformanceLocalResultSink implements LocalCapabilityResultSink {
  /** @param control - current authoritative Cloud conformance owner. */
  constructor(private readonly control: AistaffCloudConformanceControl) {}

  /** @inheritdoc */
  publish(input: LocalCapabilityResultInput): Promise<LocalCapabilityResultPublication> {
    const payload = admittedPayload(input.result.payload)
    const publication = this.control.publishLocalResult({
      operation_id: input.operation_id,
      interaction_ref: input.interaction.interaction_ref,
      interaction_revision: input.interaction.revision,
      payload,
    })
    return Promise.resolve({ material_refs: publication.material_refs })
  }
}

/**
 * Mount a fixed native selector, in-memory Supervisor, and Local Capability coordinator.
 * @param ctx - Host context already carrying the `local_read` Cloud conformance scenario.
 */
export function apply(ctx: Context): void {
  const control = ctx.get(AISTAFF_CLOUD_CONFORMANCE_CONTROL_KEY)
  if (control === undefined || control.scenario !== 'local_read') {
    throw new TypeError('cloud local conformance requires the explicit local_read scenario')
  }
  const now = (): Date => new Date('2026-08-15T00:00:00.000Z')
  const supervisor = new InMemorySupervisorControl(ctx, {
    clock: now,
    nextId: deterministicIdSource(),
    maxRequestBytes: 32_768,
    maxResultBytes: 8_192,
    intentResults: {
      'directory/list': {
        kind: 'directory',
        entries: [
          { name: '经营数据.csv', kind: 'file', size_bytes: 128 },
          { name: '归档', kind: 'directory' },
        ],
      },
    },
  })
  LocalCapabilityCoordinator.create(ctx, {
    interactions: new CloudInteractionResolver(control),
    directory_selector: new FixedNativeDirectorySelector(),
    result_sink: new CloudConformanceLocalResultSink(control),
    supervisor,
    options: {
      grant_lifetime_ms: 60_000,
      max_read_bytes: 4_096,
      read_timeout_ms: 5_000,
      now,
    },
  })
}

function admittedPayload(payload: ReadCapabilityPayload): ConformanceLocalResultPayload {
  switch (payload.kind) {
    case 'directory': return {
      kind: 'directory',
      entries: payload.entries.map(entry => ({ ...entry })),
    }
    case 'file': return {
      kind: 'file',
      text: new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes),
      media_type: payload.media_type,
    }
    case 'metadata': throw new TypeError('cloud local conformance does not publish metadata-only results')
  }
}

function managedSubject(): SupervisorSubjectBinding {
  return {
    kind: 'managed',
    tenant_id: SupervisorTenantId('fixture-tenant'),
    device_session_id: SupervisorDeviceSessionId('fixture-device-session'),
    run_id: SupervisorRunId('fixture-run'),
    step_id: SupervisorStepId('fixture-step'),
    attempt: 1,
    dsh_session_id: SupervisorDshSessionId('fixture-cloud-session'),
  }
}

function deterministicIdSource(): (kind: string) => string {
  let sequence = 0
  return kind => `fixture-cloud-local-${kind}-${String(++sequence).padStart(4, '0')}`
}
