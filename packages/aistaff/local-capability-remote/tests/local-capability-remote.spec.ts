import { Context } from '@deepseek-ai/cordis'
import {
  InteractionRef,
  LocalConsentRef,
  LocalResourceHandleRef,
  OperationId,
  OwnerRevision,
  ReceiptRef,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  OperationStatusView,
  ProductError,
  ProductResult,
} from '@deepseek-ai/dsh-aistaff-employee-experience/types'
import { LocalCapabilityObjectLayer } from '@deepseek-ai/dsh-aistaff-local-capability'
import type {
  AuthorizeLocalOperationInput,
  LocalCapabilityObservation,
  LocalCapabilityReceiptView,
  LocalCapabilitySnapshot,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from '@deepseek-ai/dsh-aistaff-local-capability/types'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import LocalCapabilityRemoteService from '../src/index.ts'
import {
  LocalCapabilityRefreshProductError,
  LocalCapabilityRemoteClientPort,
  LocalCapabilityRemoteError,
  LocalCapabilityReplacementError,
  type LocalCapabilityRemoteNamespace,
} from '../src/client/index.ts'

const interactionRef = InteractionRef('interaction-1')
const operationId = OperationId('operation-1')
const grantHandle = LocalResourceHandleRef('grant-1')
const revision = OwnerRevision('revision-1')

const resource = {
  grant_handle: grantHandle,
  display_name: '客户资料',
  resource_kind: 'directory',
  access: 'read',
  revision,
  expires_at: '2026-08-15T01:00:00.000Z',
  state: 'active',
} as const

const consent = {
  consent_ref: LocalConsentRef('consent-1'),
  interaction_ref: interactionRef,
  slot_ref: 'customer-directory',
  grant_handle: grantHandle,
  state: 'pending',
  interaction_revision: revision,
  resource_revision: revision,
  expires_at: '2026-08-15T01:00:00.000Z',
} as const

const receipt: LocalCapabilityReceiptView = {
  receipt_ref: ReceiptRef('receipt-1'),
  subject_ref: grantHandle,
  status: 'succeeded',
  effect_state: 'none',
  result_material_refs: [],
  revision,
  recorded_at: '2026-08-15T00:00:00.000Z',
}

const operation: OperationStatusView = {
  operation_id: operationId,
  action: 'localCapability',
  subject_ref: grantHandle,
  state: 'succeeded',
  receipt_ref: receipt.receipt_ref,
  revision,
  updated_at: '2026-08-15T00:00:00.000Z',
}

function snapshot(generation: number, state: LocalCapabilitySnapshot['state'] = 'ready'): LocalCapabilitySnapshot {
  return {
    state,
    resources: generation === 0 ? [] : [resource],
    consents: generation === 0 ? [] : [consent],
    receipts: generation < 2 ? [] : [receipt],
    view_generation: generation,
    observed_at: `2026-08-15T00:00:0${String(generation)}.000Z`,
  }
}

function productError(): ProductError {
  return { code: 'UNAVAILABLE', message: '本地能力暂时不可用。', retryable: true }
}

class HostCapability extends LocalCapabilityObjectLayer {
  activeTemporaryObservers = 0
  leakNextResult = false
  readonly calls: Array<{ readonly method: string, readonly input: unknown }> = []

  constructor(ctx: Context) {
    super(ctx, snapshot(1))
  }

  override observe(listener: (value: LocalCapabilitySnapshot) => void): LocalCapabilityObservation {
    const observation = super.observe(listener)
    this.activeTemporaryObservers += 1
    let active = true
    return {
      snapshot: observation.snapshot,
      dispose: () => {
        if (!active) return
        active = false
        this.activeTemporaryObservers -= 1
        observation.dispose()
      },
    }
  }

  override async selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    this.calls.push({ method: 'selectDirectory', input })
    if (this.leakNextResult) {
      this.leakNextResult = false
      return { ok: true, value: { state: 'cancelled', root_path: '/private/customer' } } as ProductResult<SelectDirectoryResult>
    }
    return { ok: true, value: { state: 'selected', resource, consent } }
  }

  override async authorizeLocalOperation(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    this.calls.push({ method: 'authorizeLocalOperation', input })
    return { ok: true, value: receipt }
  }

  override async revokeResource(input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>> {
    this.calls.push({ method: 'revokeResource', input })
    return { ok: true, value: receipt }
  }

  override async readOperation(
    input: { readonly operation_id: typeof operationId },
  ): Promise<ProductResult<OperationStatusView>> {
    this.calls.push({ method: 'readOperation', input })
    return { ok: true, value: operation }
  }
}

function carrier<T>(result: ProductResult<T>): RemoteResult<ProductResult<T>> {
  return { ok: true, value: result }
}

class FakeRemote implements LocalCapabilityRemoteNamespace {
  private lastSnapshot: LocalCapabilitySnapshot

  constructor(private readonly snapshots: LocalCapabilitySnapshot[]) {
    this.lastSnapshot = snapshots.at(-1) ?? snapshot(0, 'unavailable')
  }

  readonly getSnapshot = vi.fn<LocalCapabilityRemoteNamespace['getSnapshot']>(async () => {
    this.lastSnapshot = this.snapshots.shift() ?? this.lastSnapshot
    return carrier({ ok: true, value: this.lastSnapshot })
  })

  readonly selectDirectory = vi.fn<LocalCapabilityRemoteNamespace['selectDirectory']>(async () =>
    carrier({ ok: true, value: { state: 'selected', resource, consent } }))

  readonly authorizeLocalOperation = vi.fn<LocalCapabilityRemoteNamespace['authorizeLocalOperation']>(async () =>
    carrier({ ok: true, value: receipt }))

  readonly revokeResource = vi.fn<LocalCapabilityRemoteNamespace['revokeResource']>(async () =>
    carrier({ ok: true, value: receipt }))

  readonly readOperation = vi.fn<LocalCapabilityRemoteNamespace['readOperation']>(async () =>
    carrier({ ok: true, value: operation }))
}

describe('LocalCapabilityRemoteService', () => {
  it('invokes the exact Host port through the real Gateway and disposes snapshot bootstrap', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    const capability = new HostCapability(ctx)
    await ctx.plugin(LocalCapabilityRemoteService)

    const selectInput: SelectDirectoryInput = {
      interaction_ref: interactionRef,
      slot_ref: 'customer-directory',
      operation_id: operationId,
    }
    const authorizeInput: AuthorizeLocalOperationInput = {
      interaction_ref: interactionRef,
      grant_handle: grantHandle,
      expected_interaction_revision: revision,
      expected_resource_revision: revision,
      operation_id: operationId,
    }
    const revokeInput: RevokeResourceInput = {
      grant_handle: grantHandle,
      expected_revision: revision,
      operation_id: operationId,
    }

    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability', method: 'getSnapshot', args: {},
    })).resolves.toMatchObject({ ok: true, value: { view_generation: 1 } })
    expect(capability.activeTemporaryObservers).toBe(0)
    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability', method: 'selectDirectory', args: { input: selectInput },
    })).resolves.toMatchObject({ ok: true, value: { state: 'selected' } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability', method: 'authorizeLocalOperation', args: { input: authorizeInput },
    })).resolves.toMatchObject({ ok: true, value: { receipt_ref: receipt.receipt_ref } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability', method: 'revokeResource', args: { input: revokeInput },
    })).resolves.toMatchObject({ ok: true, value: { receipt_ref: receipt.receipt_ref } })
    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability', method: 'readOperation', args: { input: { operation_id: operationId } },
    })).resolves.toMatchObject({ ok: true, value: { operation_id: operationId } })
    expect(capability.calls).toEqual([
      { method: 'selectDirectory', input: selectInput },
      { method: 'authorizeLocalOperation', input: authorizeInput },
      { method: 'revokeResource', input: revokeInput },
      { method: 'readOperation', input: { operation_id: operationId } },
    ])
  })

  it('rejects privileged Host results before Typert serialization', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(TypertGatewayService)
    const capability = new HostCapability(ctx)
    await ctx.plugin(LocalCapabilityRemoteService)
    capability.leakNextResult = true

    await expect(ctx.typertGateway.invoke({
      namespace: 'localCapability',
      method: 'selectDirectory',
      args: { input: { interaction_ref: interactionRef, slot_ref: 'slot', operation_id: operationId } },
    })).rejects.toThrow('privileged field root_path is forbidden')
  })
})

describe('LocalCapabilityRemoteClientPort', () => {
  it('registers after bootstrap and publishes complete replacements after mutation and reconciliation', async () => {
    let settle: ((value: RemoteResult<ProductResult<LocalCapabilitySnapshot>>) => void) | undefined
    const pending = new Promise<RemoteResult<ProductResult<LocalCapabilitySnapshot>>>(resolve => { settle = resolve })
    const remote = new FakeRemote([snapshot(2), snapshot(3)])
    remote.getSnapshot.mockImplementationOnce(() => pending)
    const ctx = new Context()

    const creating = LocalCapabilityRemoteClientPort.create(ctx, remote)
    expect(ctx.get('localCapability')).toBeUndefined()
    settle?.(carrier({ ok: true, value: snapshot(1) }))
    const port = await creating
    expect(ctx.get('localCapability')).toBeInstanceOf(LocalCapabilityRemoteClientPort)

    const listener = vi.fn()
    const observation = port.observe(listener)
    const input: SelectDirectoryInput = {
      interaction_ref: interactionRef,
      slot_ref: 'customer-directory',
      operation_id: operationId,
    }
    await expect(port.selectDirectory(input)).resolves.toMatchObject({ ok: true, value: { state: 'selected' } })
    expect(remote.selectDirectory).toHaveBeenCalledWith(input)
    expect(remote.selectDirectory.mock.calls[0]?.[0].operation_id).toBe(operationId)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ view_generation: 2 }))

    await expect(port.readOperation({ operation_id: operationId })).resolves.toEqual({ ok: true, value: operation })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ view_generation: 3 }))
    expect(observation.snapshot.view_generation).toBe(1)
    observation.dispose()
  })

  it('does not publish equal replacements and rejects divergent, regressing, or privileged values', async () => {
    const stableSnapshot = snapshot(0, 'unavailable')
    const stable = await LocalCapabilityRemoteClientPort.create(
      new Context(),
      new FakeRemote([stableSnapshot, stableSnapshot]),
    )
    const listener = vi.fn()
    stable.observe(listener)
    await stable.readOperation({ operation_id: operationId })
    expect(listener).not.toHaveBeenCalled()

    const divergent = await LocalCapabilityRemoteClientPort.create(
      new Context(),
      new FakeRemote([snapshot(1), { ...snapshot(1), state: 'unavailable' }]),
    )
    await expect(divergent.revokeResource({
      grant_handle: grantHandle,
      expected_revision: revision,
      operation_id: operationId,
    })).rejects.toBeInstanceOf(LocalCapabilityReplacementError)

    const regressing = await LocalCapabilityRemoteClientPort.create(
      new Context(),
      new FakeRemote([snapshot(2), snapshot(1)]),
    )
    await expect(regressing.readOperation({ operation_id: operationId }))
      .rejects.toBeInstanceOf(LocalCapabilityReplacementError)

    for (const privileged of [
      { bytes: new Uint8Array([1]) },
      { root_path: '/private/data' },
      { socket: 'unix:///private/supervisor.sock' },
      { token: 'secret' },
      { FsTarget: { displayPath: '/private/data', targetKey: 'host-only' } },
    ]) {
      const unsafe = new FakeRemote([snapshot(1)])
      unsafe.getSnapshot.mockResolvedValueOnce(carrier({
        ok: true,
        value: { ...snapshot(1), ...privileged } as LocalCapabilitySnapshot,
      }))
      await expect(LocalCapabilityRemoteClientPort.create(new Context(), unsafe))
        .rejects.toBeInstanceOf(LocalCapabilityReplacementError)
    }
  })

  it('keeps ProductError and carrier failures separate and does not refresh failed operations', async () => {
    const remote = new FakeRemote([snapshot(1)])
    const port = await LocalCapabilityRemoteClientPort.create(new Context(), remote)
    const failure = productError()
    remote.selectDirectory.mockResolvedValueOnce(carrier({ ok: false, error: failure }))

    await expect(port.selectDirectory({
      interaction_ref: interactionRef,
      slot_ref: 'customer-directory',
      operation_id: operationId,
    })).resolves.toEqual({ ok: false, error: failure })
    expect(remote.getSnapshot).toHaveBeenCalledTimes(1)

    remote.readOperation.mockResolvedValueOnce({
      ok: false,
      error: { code: 'unavailable', message: 'Host unavailable', details: {} },
    })
    await expect(port.readOperation({ operation_id: operationId }))
      .rejects.toBeInstanceOf(LocalCapabilityRemoteError)
  })

  it('retains the bootstrap ProductError category and leaves the service unregistered', async () => {
    const remote = new FakeRemote([])
    const failure = productError()
    remote.getSnapshot.mockResolvedValueOnce(carrier({ ok: false, error: failure }))
    const ctx = new Context()

    await expect(LocalCapabilityRemoteClientPort.create(ctx, remote)).rejects.toMatchObject({
      name: 'LocalCapabilityRefreshProductError',
      productError: failure,
    })
    await expect(LocalCapabilityRemoteClientPort.create(new Context(), {
      ...remote,
      getSnapshot: async () => carrier({ ok: false, error: failure }),
    })).rejects.toBeInstanceOf(LocalCapabilityRefreshProductError)
    expect(ctx.get('localCapability')).toBeUndefined()
  })
})
