// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { Context } from '@deepseek-ai/cordis'
import {
  ActivityRef,
  EmployeeRef,
  EngagementRef,
  InteractionRef,
  LocalConsentRef,
  LocalResourceHandleRef,
  MaterialRef,
  OperationId,
  OwnerRevision,
  ReceiptRef,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  EmployeeExperienceSnapshot,
  OperationStatusView,
  ProductResult,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import {
  LocalCapabilityObjectLayer,
} from '@deepseek-ai/dsh-aistaff-local-capability'
import type {
  AuthorizeLocalOperationInput,
  LocalCapabilityReceiptView,
  LocalCapabilitySnapshot,
  RevokeResourceInput,
  SelectDirectoryInput,
  SelectDirectoryResult,
} from '@deepseek-ai/dsh-aistaff-local-capability'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudAistaffWorkbench, type CloudWorkbenchInjected } from '../src/cloud-client/CloudAistaffWorkbench.tsx'
import { createLocalCapabilityWorkbenchInjected } from '../src/cloud-client/adapter.ts'
import { createLocalCapabilityExternalStore } from '../src/cloud-client/external-store.ts'
import { createCloudProductStore } from '../src/cloud-client/store.ts'

afterEach(cleanup)

const INTERACTION_REVISION = OwnerRevision('interaction-revision-1')
const RESOURCE_REVISION = OwnerRevision('resource-revision-1')
const INTERACTION_REF = InteractionRef('local-interaction-1')
const GRANT_HANDLE = LocalResourceHandleRef('local-grant-1')
const CONSENT_REF = LocalConsentRef('local-consent-1')
const MATERIAL_REF = MaterialRef('local-material-1')

function employeeSnapshot(): EmployeeExperienceSnapshot {
  const employeeRef = EmployeeRef('employee-1')
  const engagementRef = EngagementRef('engagement-1')
  const activityRef = ActivityRef('activity-1')
  const engagement = {
    engagement_ref: engagementRef,
    employee_ref: employeeRef,
    title: '本机资料分析',
    display_state: 'waiting_user' as const,
    latest_activity_ref: activityRef,
    revision: INTERACTION_REVISION,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:01.000Z',
  }
  return {
    state: 'ready',
    workforce: {
      revision: INTERACTION_REVISION,
      employees: [{
        employee_ref: employeeRef,
        display_name: '资料整理员工',
        role_label: '企业资料分析',
        availability: 'ready',
        capability_labels: ['本机只读'],
        allowed_actions: { open: { allowed: true } },
      }],
      observed_at: '2026-08-15T00:00:01.000Z',
    },
    engagements: [engagement],
    has_more_engagements: false,
    current_engagement: {
      engagement,
      activities: [{
        activity_ref: activityRef,
        engagement_ref: engagementRef,
        employee_ref: employeeRef,
        display_state: 'waiting_user',
        material_refs: [MATERIAL_REF],
        interaction_refs: [INTERACTION_REF],
        revision: INTERACTION_REVISION,
        created_at: '2026-08-15T00:00:00.000Z',
        updated_at: '2026-08-15T00:00:01.000Z',
      }],
      materials: [{
        material_ref: MATERIAL_REF,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '本机目录结果',
        body: { kind: 'text', format: 'plain_text', text: '结果由 canonical Material 呈现' },
        presentation: 'inline',
        state: 'available',
        allowed_actions: {},
        revision: INTERACTION_REVISION,
        created_at: '2026-08-15T00:00:01.000Z',
      }],
      interactions: [{
        kind: 'local_operation',
        interaction_ref: INTERACTION_REF,
        engagement_ref: engagementRef,
        activity_ref: activityRef,
        title: '读取客户资料目录',
        summary: '仅列出你选择目录中的直接子项。',
        allowed_outcome_ids: ['deny', 'cancel'],
        revision: INTERACTION_REVISION,
        capability_ref: 'directory/list',
        operation: 'directory/list',
        argument_schema_ref: 'directory-list-v1',
        arguments: { relative_segments: [] },
        risk: 'medium',
        effect_class: 'none',
        resource_requirements: [{
          slot_ref: 'customer-directory',
          resource_kind: 'directory',
          access: 'read',
          scope_constraint_ref: 'direct-children',
          scope_constraint_hash: 'sha256:direct-children',
        }],
        consent_required: true,
      }],
      receipts: [],
      has_more: false,
      owner_revision: INTERACTION_REVISION,
    },
    view_generation: 1,
    observed_at: '2026-08-15T00:00:01.000Z',
  }
}

function localSnapshot(): LocalCapabilitySnapshot {
  return {
    state: 'ready',
    resources: [],
    consents: [],
    receipts: [],
    view_generation: 0,
    observed_at: '2026-08-15T00:00:00.000Z',
  }
}

class LocalFlowPort extends LocalCapabilityObjectLayer {
  readonly mutationOperationIds: string[] = []
  readonly reconciledOperationIds: string[] = []
  private cancelSelection = false
  private authorizeMode: 'success' | 'stale' | 'unknown' = 'success'
  private unknownSettled = false
  private readonly privilegedFixturePath = '/private/customer/contracts'

  constructor(ctx: Context) {
    super(ctx, localSnapshot())
  }

  cancelNextSelection(): void {
    this.cancelSelection = true
  }

  setAuthorizeMode(mode: 'success' | 'stale' | 'unknown'): void {
    this.authorizeMode = mode
  }

  settleUnknown(): void {
    this.unknownSettled = true
  }

  override async selectDirectory(input: SelectDirectoryInput): Promise<ProductResult<SelectDirectoryResult>> {
    this.mutationOperationIds.push(input.operation_id)
    if (this.cancelSelection) {
      this.cancelSelection = false
      return { ok: true, value: { state: 'cancelled' } }
    }
    void this.privilegedFixturePath
    const resource = {
      grant_handle: GRANT_HANDLE,
      display_name: '客户合同',
      resource_kind: 'directory' as const,
      access: 'read' as const,
      revision: RESOURCE_REVISION,
      expires_at: '2026-08-15T00:10:00.000Z',
      state: 'active' as const,
    }
    const consent = {
      consent_ref: CONSENT_REF,
      interaction_ref: input.interaction_ref,
      slot_ref: input.slot_ref,
      grant_handle: GRANT_HANDLE,
      state: 'pending' as const,
      interaction_revision: INTERACTION_REVISION,
      resource_revision: RESOURCE_REVISION,
      expires_at: resource.expires_at,
    }
    this.publishReplacement({
      ...this.currentSnapshot(),
      resources: [resource],
      consents: [consent],
      view_generation: this.currentSnapshot().view_generation + 1,
    })
    return { ok: true, value: { state: 'selected', resource, consent } }
  }

  override async authorizeLocalOperation(
    input: AuthorizeLocalOperationInput,
  ): Promise<ProductResult<LocalCapabilityReceiptView>> {
    this.mutationOperationIds.push(input.operation_id)
    if (this.authorizeMode === 'stale') {
      return {
        ok: false,
        error: {
          code: 'VERSION_MISMATCH',
          message: '本机授权已更新，请重新选择。',
          retryable: false,
          current_revision: RESOURCE_REVISION,
        },
      }
    }
    this.publishConsentAuthorized()
    if (this.authorizeMode === 'unknown') {
      return {
        ok: false,
        error: {
          code: 'UNKNOWN_OUTCOME',
          message: '本地结果未知。',
          retryable: true,
          operation_id: input.operation_id,
        },
      }
    }
    return { ok: true, value: this.publishReceipt() }
  }

  override async revokeResource(_input: RevokeResourceInput): Promise<ProductResult<LocalCapabilityReceiptView>> {
    throw new Error('not used by this UI fixture')
  }

  override async readOperation(
    input: { readonly operation_id: ReturnType<typeof OperationId> },
  ): Promise<ProductResult<OperationStatusView>> {
    this.reconciledOperationIds.push(input.operation_id)
    if (this.unknownSettled) this.publishReceipt()
    return {
      ok: true,
      value: {
        operation_id: input.operation_id,
        action: 'authorizeLocalOperation',
        subject_ref: INTERACTION_REF,
        state: this.unknownSettled ? 'succeeded' : 'unknown',
        ...(this.unknownSettled ? { receipt_ref: ReceiptRef('local-receipt-1') } : {}),
        revision: OwnerRevision('local-operation-revision'),
        updated_at: '2026-08-15T00:00:03.000Z',
      },
    }
  }

  private publishConsentAuthorized(): void {
    const current = this.currentSnapshot()
    this.publishReplacement({
      ...current,
      consents: current.consents.map(consent => ({ ...consent, state: 'authorized' })),
      view_generation: current.view_generation + 1,
    })
  }

  private publishReceipt(): LocalCapabilityReceiptView {
    const current = this.currentSnapshot()
    const existing = current.receipts[0]
    if (existing !== undefined) return existing
    const receipt: LocalCapabilityReceiptView = {
      receipt_ref: ReceiptRef('local-receipt-1'),
      subject_ref: INTERACTION_REF,
      status: 'succeeded',
      effect_state: 'none',
      result_material_refs: [MATERIAL_REF],
      revision: OwnerRevision('local-receipt-revision'),
      recorded_at: '2026-08-15T00:00:03.000Z',
    }
    this.publishReplacement({
      ...current,
      receipts: [receipt],
      view_generation: current.view_generation + 1,
    })
    return receipt
  }
}

type CloudStore = ReturnType<ReturnType<typeof createCloudProductStore>['create']>

function bindStore(store: CloudStore): SnapshotSelectorHook<ReturnType<CloudStore['getSnapshot']>> {
  return selector => useSyncExternalStore(store.subscribe, () => selector(store.getSnapshot()))
}

function operationIdFactory(): ReturnType<typeof vi.fn<() => ReturnType<typeof OperationId>>> {
  let sequence = 0
  return vi.fn(() => OperationId(`local-ui-operation-${String(++sequence)}`))
}

function renderWorkbench(options: { readonly port?: LocalFlowPort } = {}) {
  const store = createCloudProductStore().create()
  store.actions.openWorkbench()
  store.actions.selectEmployee(EmployeeRef('employee-1'))
  store.actions.selectEngagement(EngagementRef('engagement-1'))
  const respondInteraction = vi.fn(async () => true)
  const createId = operationIdFactory()
  const refreshExperience = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const localStore = options.port === undefined ? undefined : createLocalCapabilityExternalStore(options.port)
  const localCapability = options.port === undefined || localStore === undefined
    ? undefined
    : createLocalCapabilityWorkbenchInjected(
        options.port,
        localStore,
        store.actions,
        refreshExperience,
        createId,
      )
  const injected: CloudWorkbenchInjected = {
    useExperience: employeeSnapshot,
    openEngagement: async () => true,
    selectEngagement: async () => true,
    submitText: async () => true,
    respondInteraction,
    requestMaterialAccess: async () => true,
    ...(localCapability === undefined ? {} : { localCapability }),
  }
  render(
    <CloudAistaffWorkbench
      useSessions={(() => undefined) as never}
      useWorkspaces={(() => undefined) as never}
      useStore={bindStore(store)}
      actions={store.actions}
      {...injected}
    />,
  )
  return { store, respondInteraction, createId, refreshExperience, localStore }
}

describe('optional Local Capability workbench flow', () => {
  it('preserves the Cloud-only disabled state when no provider is injected', () => {
    renderWorkbench()

    expect(screen.getByText('读取客户资料目录')).toBeDefined()
    expect(screen.getByText('仅列出你选择目录中的直接子项。')).toBeDefined()
    expect(screen.getByText('当前 Cloud-only 模式不允许执行本机操作。')).toBeDefined()
    expect(screen.queryByRole('button', { name: '选择目录' })).toBeNull()
  })

  it('contains cancellation, then shows only a path-free selected resource and Cloud outcomes', async () => {
    const port = new LocalFlowPort(new Context())
    port.cancelNextSelection()
    const rendered = renderWorkbench({ port })

    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    await waitFor(() => { expect(rendered.createId).toHaveBeenCalledTimes(1) })
    expect(screen.queryByText('客户合同')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    await waitFor(() => { expect(screen.getByText('客户合同')).toBeDefined() })
    expect(screen.getByText('Local Consent：等待本地允许')).toBeDefined()
    expect(screen.getByText('目录 · 只读')).toBeDefined()
    expect(document.body.textContent).not.toContain('/private/customer/contracts')
    expect(document.body.innerHTML).not.toMatch(/root_path|socket|token|FsTarget|capability_context/i)

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(rendered.respondInteraction).toHaveBeenCalledWith(
      INTERACTION_REF,
      'cancel',
      INTERACTION_REVISION,
    )
    rendered.localStore?.dispose()
  })

  it('authorizes once and renders only sanitized Receipt fields and canonical Material refs', async () => {
    const port = new LocalFlowPort(new Context())
    const rendered = renderWorkbench({ port })
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    await screen.findByText('客户合同')
    fireEvent.click(screen.getByRole('button', { name: '允许本次只读' }))

    await screen.findByText('Local Consent：本次已允许')
    expect(screen.getByText('本地回执：已完成')).toBeDefined()
    expect(screen.getByText(`关联产出：${MATERIAL_REF}`)).toBeDefined()
    expect(screen.getByText('本机目录结果')).toBeDefined()
    expect(port.mutationOperationIds).toEqual(['local-ui-operation-1', 'local-ui-operation-2'])
    expect(new Set(port.mutationOperationIds).size).toBe(2)
    expect(rendered.refreshExperience).toHaveBeenCalledTimes(1)
    expect(rendered.store.getSnapshot().busy).toBe(false)
    rendered.localStore?.dispose()
  })

  it('shows a stale-revision error only in transient Store state', async () => {
    const port = new LocalFlowPort(new Context())
    port.setAuthorizeMode('stale')
    const rendered = renderWorkbench({ port })
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    await screen.findByText('客户合同')
    fireEvent.click(screen.getByRole('button', { name: '允许本次只读' }))

    await screen.findByRole('alert')
    expect(rendered.store.getSnapshot().error).toBe('本机授权已更新，请重新选择。')
    expect(Object.keys(rendered.store.getSnapshot()).sort()).toEqual([
      'busy', 'draft', 'error', 'open', 'selectedEmployeeRef', 'selectedEngagementRef',
    ])
    rendered.localStore?.dispose()
  })

  it('reconciles unknown with the original authorization OperationId', async () => {
    const port = new LocalFlowPort(new Context())
    port.setAuthorizeMode('unknown')
    const rendered = renderWorkbench({ port })
    fireEvent.click(screen.getByRole('button', { name: '选择目录' }))
    await screen.findByText('客户合同')
    fireEvent.click(screen.getByRole('button', { name: '允许本次只读' }))

    await screen.findByText('查询本次结果')
    expect(port.reconciledOperationIds).toEqual(['local-ui-operation-2'])
    expect(rendered.store.getSnapshot().error).toBe('本地操作结果仍在确认中，请使用本次操作继续查询。')
    port.settleUnknown()
    fireEvent.click(screen.getByRole('button', { name: '查询本次结果' }))

    await screen.findByText('本地回执：已完成')
    expect(port.reconciledOperationIds).toEqual(['local-ui-operation-2', 'local-ui-operation-2'])
    expect(rendered.createId).toHaveBeenCalledTimes(2)
    expect(rendered.refreshExperience).toHaveBeenCalledTimes(1)
    expect(rendered.store.getSnapshot().error).toBeNull()
    rendered.localStore?.dispose()
  })

  it('retains a thrown directory selection and replays only its original id after NOT_FOUND', async () => {
    const operationId = OperationId('local-select-original')
    const selectDirectory = vi.fn(async (input: SelectDirectoryInput) => {
      if (selectDirectory.mock.calls.length === 1) throw new Error('snapshot refresh failed after commit')
      return { ok: true as const, value: { state: 'cancelled' as const, operation_id: input.operation_id } }
    })
    const readOperation = vi.fn(async (input: { readonly operation_id: ReturnType<typeof OperationId> }) => {
      const call = readOperation.mock.calls.length
      if (call === 1) {
        return {
          ok: true as const,
          value: {
            operation_id: input.operation_id,
            action: 'selectDirectory',
            state: 'pending' as const,
            revision: RESOURCE_REVISION,
            updated_at: '2026-08-15T00:00:00.000Z',
          },
        }
      }
      return {
        ok: false as const,
        error: { code: 'NOT_FOUND' as const, message: '尚未登记', retryable: false },
      }
    })
    const port = { selectDirectory, readOperation } as unknown as LocalCapabilityObjectLayer
    const store = createCloudProductStore().create()
    const createId = vi.fn(() => operationId)
    const refreshExperience = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const injected = createLocalCapabilityWorkbenchInjected(
      port,
      {} as never,
      store.actions,
      refreshExperience,
      createId,
    )

    expect(await injected.selectDirectory(INTERACTION_REF, 'customer-directory')).toBe(false)
    expect(await injected.selectDirectory(INTERACTION_REF, 'customer-directory')).toBe(true)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(readOperation).toHaveBeenCalledTimes(2)
    expect(selectDirectory).toHaveBeenCalledTimes(2)
    expect(selectDirectory.mock.calls.map(([input]) => input.operation_id)).toEqual([operationId, operationId])
    expect(refreshExperience).not.toHaveBeenCalled()
  })

  it('keeps a thrown authorization on the query path and refreshes Cloud with its original id', async () => {
    const operationId = OperationId('local-authorize-original')
    const authorizeLocalOperation = vi.fn(async () => {
      throw new Error('local snapshot refresh failed after commit')
    })
    const readOperation = vi.fn(async (input: { readonly operation_id: ReturnType<typeof OperationId> }) => ({
      ok: true as const,
      value: {
        operation_id: input.operation_id,
        action: 'authorizeLocalOperation',
        state: readOperation.mock.calls.length === 1 ? 'pending' as const : 'succeeded' as const,
        revision: RESOURCE_REVISION,
        updated_at: '2026-08-15T00:00:00.000Z',
      },
    }))
    const port = { authorizeLocalOperation, readOperation } as unknown as LocalCapabilityObjectLayer
    const store = createCloudProductStore().create()
    const createId = vi.fn(() => operationId)
    const refreshExperience = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const injected = createLocalCapabilityWorkbenchInjected(
      port,
      {} as never,
      store.actions,
      refreshExperience,
      createId,
    )

    expect(await injected.authorizeLocalOperation(
      INTERACTION_REF,
      GRANT_HANDLE,
      INTERACTION_REVISION,
      RESOURCE_REVISION,
    )).toBe(false)
    expect(await injected.reconcileLocalOperation(INTERACTION_REF)).toBe(true)
    expect(createId).toHaveBeenCalledTimes(1)
    expect(authorizeLocalOperation).toHaveBeenCalledTimes(1)
    expect(readOperation.mock.calls.map(([input]) => input.operation_id)).toEqual([operationId, operationId])
    expect(refreshExperience).toHaveBeenCalledTimes(1)
  })

  it('shows only the display-safe Employee refresh failure after successful authorization', async () => {
    const port = new LocalFlowPort(new Context())
    const localStore = createLocalCapabilityExternalStore(port)
    const store = createCloudProductStore().create()
    const createId = operationIdFactory()
    const refreshExperience = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'UNAVAILABLE' as const,
        message: '协作刷新暂不可用。',
        retryable: true,
      },
    }))
    const injected = createLocalCapabilityWorkbenchInjected(
      port,
      localStore,
      store.actions,
      refreshExperience,
      createId,
    )

    expect(await injected.selectDirectory(INTERACTION_REF, 'customer-directory')).toBe(true)
    expect(await injected.authorizeLocalOperation(
      INTERACTION_REF,
      GRANT_HANDLE,
      INTERACTION_REVISION,
      RESOURCE_REVISION,
    )).toBe(false)
    expect(refreshExperience).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().error).toBe('协作刷新暂不可用。')
    expect(Object.keys(store.getSnapshot())).not.toContain('operationId')
    localStore.dispose()
  })
})
