/** Test-only complete local capability conformance composition. */

import { Context, Service } from '@voyaseek-ai/cordis'
import {
  ActivityRef,
  EngagementRef,
  InteractionRef,
  MaterialRef,
  OwnerRevision,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type {
  InteractionRef as InteractionRefType,
  LocalOperationRequestView,
} from '@voyaseek-ai/dsh-aistaff-employee-experience/types'
import {
  LocalCapabilityCoordinator,
} from '@voyaseek-ai/dsh-aistaff-local-capability'
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
  SupervisorActivityRef,
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
import {
  InMemorySupervisorControl,
} from '@voyaseek-ai/dsh-aistaff-supervisor-control/testing'

/** Immutable marker preventing accidental use as a production provider. */
export const LOCAL_CAPABILITY_CONFORMANCE_PROVENANCE = Object.freeze({
  test_only: true,
  fixture_version: 'aistaff-local-capability-conformance.v1',
  root_hash: 'sha256:9b723d30cbd8f60f47ae87c0e64539066b21589b0fa26dab52beddf0217600db',
})

/** Stable test-control service key. */
export const LOCAL_CAPABILITY_CONFORMANCE_SERVICE_KEY = 'aistaffLocalCapabilityConformance' as const

declare module '@voyaseek-ai/cordis' {
  interface Context {
    /** Test-only deterministic local capability controls. */
    aistaffLocalCapabilityConformance: LocalCapabilityConformanceControl
  }
}

/** Mutable clock owned only by the test-only conformance composition. */
export class ConformanceClock {
  private instant = Date.parse('2026-08-15T00:00:00.000Z')

  /**
   * Read the current deterministic fixture time.
   * @returns the current deterministic fixture time.
   */
  now: () => Date = (): Date => new Date(this.instant)

  /**
   * Advance deterministic fixture time.
   * @param milliseconds - positive time interval.
   */
  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new TypeError('milliseconds must be positive')
    this.instant += milliseconds
  }
}

/** Fixed authoritative interaction resolver used only by conformance tests. */
export class ConformanceInteractionResolver implements LocalOperationInteractionResolver {
  private current: AuthoritativeLocalOperation | null

  /**
   * Create a resolver from one fixed authoritative operation.
   * @param current - initial request and verified Supervisor subject.
   */
  constructor(current: AuthoritativeLocalOperation) {
    this.current = current
  }

  /** @inheritdoc */
  resolve(interactionRef: InteractionRefType): Promise<AuthoritativeLocalOperation | null> {
    return Promise.resolve(this.current?.request.interaction_ref === interactionRef ? this.current : null)
  }

  /**
   * Replace or remove the authoritative interaction.
   * @param current - next complete request and subject, or null.
   */
  replace(current: AuthoritativeLocalOperation | null): void {
    this.current = current
  }

  /**
   * Read the current fixed authoritative value.
   * @returns the current value for deterministic test mutation.
   */
  read(): AuthoritativeLocalOperation | null {
    return this.current
  }
}

/** Trusted fixture selector whose absolute path remains in a private Host field. */
export class ConformanceDirectorySelector implements HostDirectorySelector {
  private cancel = false
  private readonly rootPath = '/fixture/customer-documents'
  /** Number of native selection calls observed by the fixture. */
  calls: number = 0

  /** Cancel the next native selection exactly once. */
  cancelNext(): void {
    this.cancel = true
  }

  /** @inheritdoc */
  selectDirectory(_input: HostDirectorySelectionInput): Promise<HostDirectorySelection | null> {
    this.calls += 1
    if (this.cancel) {
      this.cancel = false
      return Promise.resolve(null)
    }
    return Promise.resolve({ root_path: this.rootPath, display_name: '客户资料' })
  }
}

/** Test-only sink that represents the canonical external Material owner. */
export class ConformanceResultSink implements LocalCapabilityResultSink {
  private lastKind: ReadCapabilityPayload['kind'] | undefined
  private fail = false

  /** @inheritdoc */
  publish(input: LocalCapabilityResultInput): Promise<LocalCapabilityResultPublication> {
    this.lastKind = input.result.payload.kind
    if (this.fail) {
      this.fail = false
      return Promise.reject(new Error('fixture result publication failed'))
    }
    return Promise.resolve({
      material_refs: [MaterialRef(`local-material:${input.operation_id}`)],
    })
  }

  /**
   * Read the last Host-only payload category without its content.
   * @returns the last published payload category.
   */
  lastPayloadKind(): ReadCapabilityPayload['kind'] | undefined {
    return this.lastKind
  }

  /** Fail the next canonical Material publication exactly once. */
  failNext(): void {
    this.fail = true
  }
}

/** Test-only controls for cancellation, expiry, owner change, and unknown outcomes. */
export class LocalCapabilityConformanceControl extends Service {
  /** Deterministic clock. */
  readonly clock: ConformanceClock
  /** Authoritative interaction resolver. */
  readonly interactions: ConformanceInteractionResolver
  /** Trusted native selector. */
  readonly directorySelector: ConformanceDirectorySelector
  /** Canonical Material sink. */
  readonly resultSink: ConformanceResultSink
  private readonly intentResults: Record<string, ReadCapabilityPayload | { readonly kind: 'unknown' }>

  /**
   * Register the control service over fixed conformance dependencies.
   * @param ctx - isolated conformance Host context.
   * @param inputs - fixed mutable test controls.
   */
  constructor(ctx: Context, inputs: {
    readonly clock: ConformanceClock
    readonly interactions: ConformanceInteractionResolver
    readonly directorySelector: ConformanceDirectorySelector
    readonly resultSink: ConformanceResultSink
    readonly intentResults: Record<string, ReadCapabilityPayload | { readonly kind: 'unknown' }>
  }) {
    super(ctx, LOCAL_CAPABILITY_CONFORMANCE_SERVICE_KEY)
    this.clock = inputs.clock
    this.interactions = inputs.interactions
    this.directorySelector = inputs.directorySelector
    this.resultSink = inputs.resultSink
    this.intentResults = inputs.intentResults
  }

  /** Make subsequent directory reads settle as an uncertain Supervisor outcome. */
  useUnknownOutcome(): void {
    this.intentResults['directory/list'] = { kind: 'unknown' }
  }
}

/** Cordis plugin name. */
export const name = 'aistaff-local-capability-conformance'

/** The fixture owns every dependency and consumes no production provider. */
export const inject: readonly string[] = []

/**
 * Mount the fixed test-only interaction, native selection, Supervisor, result sink, and object layer.
 * @param ctx - isolated conformance Host context.
 */
export function apply(ctx: Context): void {
  const clock = new ConformanceClock()
  const interactions = new ConformanceInteractionResolver(fixedOperation())
  const directorySelector = new ConformanceDirectorySelector()
  const resultSink = new ConformanceResultSink()
  const intentResults: Record<string, ReadCapabilityPayload | { readonly kind: 'unknown' }> = {
    'directory/list': {
      kind: 'directory',
      entries: [{ name: '经营数据.csv', kind: 'file', size_bytes: 128 }],
    },
  }
  const supervisor = new InMemorySupervisorControl(ctx, {
    clock: clock.now,
    nextId: deterministicIdSource(),
    maxRequestBytes: 32_768,
    maxResultBytes: 8_192,
    intentResults,
  })
  new LocalCapabilityConformanceControl(ctx, {
    clock,
    interactions,
    directorySelector,
    resultSink,
    intentResults,
  })
  LocalCapabilityCoordinator.create(ctx, {
    interactions,
    directory_selector: directorySelector,
    result_sink: resultSink,
    supervisor,
    options: {
      grant_lifetime_ms: 60_000,
      max_read_bytes: 4_096,
      read_timeout_ms: 5_000,
      now: clock.now,
    },
  })
}

/**
 * Create the fixed current authoritative local operation for direct package tests.
 * @returns the request and verified Supervisor subject.
 */
export function fixedOperation(): AuthoritativeLocalOperation {
  const subject: SupervisorSubjectBinding = {
    kind: 'managed',
    tenant_id: SupervisorTenantId('fixture-tenant'),
    device_session_id: SupervisorDeviceSessionId('fixture-device-session'),
    run_id: SupervisorRunId('fixture-run'),
    step_id: SupervisorStepId('fixture-step'),
    attempt: 1,
    dsh_session_id: SupervisorDshSessionId('fixture-cloud-session'),
  }
  return {
    request: fixedRequest(),
    subject,
  }
}

/**
 * Create the fixed Renderer-safe local operation request.
 * @returns the current fixture request.
 */
export function fixedRequest(): LocalOperationRequestView {
  return {
    kind: 'local_operation',
    interaction_ref: InteractionRef('fixture-local-interaction'),
    engagement_ref: EngagementRef('fixture-engagement'),
    activity_ref: ActivityRef('fixture-activity'),
    title: '读取客户资料目录',
    summary: '列出所选目录中的直接子项。',
    allowed_outcome_ids: ['authorize', 'deny'],
    revision: OwnerRevision('fixture-interaction-revision-1'),
    expires_at: '2026-08-15T00:05:00.000Z',
    capability_ref: 'directory/list',
    operation: 'directory/list',
    argument_schema_ref: 'fixture-directory-list-arguments',
    arguments: { relative_segments: [], max_bytes: 2_048 },
    risk: 'medium',
    effect_class: 'none',
    resource_requirements: [{
      slot_ref: 'customer-directory',
      resource_kind: 'directory',
      access: 'read',
      scope_constraint_ref: 'fixture-direct-children',
      scope_constraint_hash: 'sha256:fixture-direct-children',
    }],
    consent_required: true,
  }
}

/**
 * Create one fixed local subject for optional direct Supervisor tests.
 * @returns the local fixture subject.
 */
export function fixedLocalSubject(): SupervisorSubjectBinding {
  return {
    kind: 'local',
    activity_ref: SupervisorActivityRef('fixture-local-activity'),
    dsh_session_id: SupervisorDshSessionId('fixture-local-session'),
  }
}

function deterministicIdSource(): (kind: string) => string {
  let sequence = 0
  return kind => `fixture-${kind}-${String(++sequence).padStart(4, '0')}`
}
