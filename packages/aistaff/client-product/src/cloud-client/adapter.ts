import type {
  ActivityView,
  EffectReceiptView,
  EmployeeExperiencePort,
  EngagementView,
  JsonValue,
  MaterialAccessGrant,
  OperationStatusView,
  ProductError,
  ProductResult,
} from '@voyaseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalCapabilityPort,
  LocalResourceView,
} from '@voyaseek-ai/dsh-aistaff-local-capability'
import type { BoundActions } from '@voyaseek-ai/dsh-client-ui-slots'
import type { CloudWorkbenchInjected, LocalCapabilityWorkbenchInjected } from './CloudAistaffWorkbench.tsx'
import type { EmployeeExperienceExternalStore, LocalCapabilityExternalStore } from './external-store.ts'
import { useEmployeeExperience, useLocalCapability } from './external-store.ts'
import type { createCloudProductStore } from './store.ts'

type EmployeeRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').EmployeeRef>
type EngagementRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').EngagementRef>
type InteractionRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').InteractionRef>
type MaterialRef = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').MaterialRef>
type OperationId = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').OperationId>
type OwnerRevision = ReturnType<typeof import('@voyaseek-ai/dsh-aistaff-employee-experience').OwnerRevision>

type CloudActions = BoundActions<ReturnType<typeof createCloudProductStore>>
type Reconciliation = 'settled_success' | 'settled_failure' | 'pending' | 'not_found'

interface OperationReader {
  readonly readOperation: (
    input: { readonly operation_id: OperationId },
  ) => Promise<ProductResult<OperationStatusView>>
}

interface ReconciliationMessages {
  readonly pending: string
  readonly failed: string
  readonly readFailed: string
}

interface PendingMutation<T> {
  readonly operationId: OperationId
  readonly replay: () => Promise<ProductResult<T>>
}

type MutationOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly recovered: boolean }

type LocalMutationKind = 'select' | 'authorize'

interface LocalPendingMutation extends PendingMutation<unknown> {
  readonly kind: LocalMutationKind
}

interface LocalMutationOutcome {
  readonly kind: LocalMutationKind
  readonly succeeded: boolean
}

/** Operation-id factory supplied by the browser shell or deterministic tests. */
export type OperationIdFactory = () => OperationId

/** Explicit Employee Experience refresh performed after a local authorization settles. */
export type ExperienceRefresh = () => Promise<ProductResult<unknown>>

/** Create one browser-owned opaque idempotency identity. */
function browserOperationId(): OperationId {
  return crypto.randomUUID() as OperationId
}

function showError(error: ProductError, actions: CloudActions): void {
  actions.setError(error.message)
}

/** Read one original operation without changing its idempotency identity. */
async function reconcile(
  port: OperationReader,
  operationId: OperationId,
  actions: CloudActions,
  messages: ReconciliationMessages,
): Promise<Reconciliation> {
  let status: ProductResult<OperationStatusView>
  try {
    status = await port.readOperation({ operation_id: operationId })
  } catch {
    actions.setError(messages.readFailed)
    return 'pending'
  }
  if (!status.ok) {
    if (status.error.code === 'NOT_FOUND') return 'not_found'
    showError(status.error, actions)
    return 'pending'
  }
  switch (status.value.state) {
    case 'accepted':
    case 'succeeded':
      actions.setError(null)
      return 'settled_success'
    case 'pending':
    case 'unknown':
      actions.setError(messages.pending)
      return 'pending'
    case 'failed':
    case 'rejected':
      actions.setError(messages.failed)
      return 'settled_failure'
  }
}

const CLOUD_RECONCILIATION_MESSAGES: ReconciliationMessages = {
  pending: '操作结果仍在确认中，请稍后查看。',
  failed: '操作未完成，请查看最新回执。',
  readFailed: '无法查询 AI 员工操作，请稍后重试。',
}

const LOCAL_RECONCILIATION_MESSAGES: ReconciliationMessages = {
  pending: '本地操作结果仍在确认中，请使用本次操作继续查询。',
  failed: '本地操作未完成，请查看最新本地回执。',
  readFailed: '无法查询本地操作，请稍后重试。',
}

async function executeCloudMutation<T>(
  port: EmployeeExperiencePort,
  pendingBySemantic: Map<string, PendingMutation<T>>,
  semanticKey: string,
  pending: PendingMutation<T>,
  actions: CloudActions,
  replayOnNotFound: boolean,
): Promise<MutationOutcome<T>> {
  let result: ProductResult<T>
  try {
    result = await pending.replay()
  } catch {
    return reconcileCloudMutation(
      port,
      pendingBySemantic,
      semanticKey,
      pending,
      actions,
      replayOnNotFound,
    )
  }
  if (result.ok) {
    pendingBySemantic.delete(semanticKey)
    actions.setError(null)
    return result
  }
  if (result.error.code !== 'UNKNOWN_OUTCOME') {
    pendingBySemantic.delete(semanticKey)
    showError(result.error, actions)
    return { ok: false, recovered: false }
  }
  return reconcileCloudMutation(
    port,
    pendingBySemantic,
    semanticKey,
    pending,
    actions,
    replayOnNotFound,
  )
}

async function reconcileCloudMutation<T>(
  port: EmployeeExperiencePort,
  pendingBySemantic: Map<string, PendingMutation<T>>,
  semanticKey: string,
  pending: PendingMutation<T>,
  actions: CloudActions,
  replayOnNotFound: boolean,
): Promise<MutationOutcome<T>> {
  const state = await reconcile(port, pending.operationId, actions, CLOUD_RECONCILIATION_MESSAGES)
  switch (state) {
    case 'settled_success':
      pendingBySemantic.delete(semanticKey)
      return { ok: false, recovered: true }
    case 'settled_failure':
      pendingBySemantic.delete(semanticKey)
      return { ok: false, recovered: false }
    case 'pending':
      return { ok: false, recovered: false }
    case 'not_found':
      if (!replayOnNotFound) {
        actions.setError(CLOUD_RECONCILIATION_MESSAGES.pending)
        return { ok: false, recovered: false }
      }
      return executeCloudMutation(
        port,
        pendingBySemantic,
        semanticKey,
        pending,
        actions,
        false,
      )
  }
}

/** Run one Cloud mutation while retaining its input only during uncertain outcome recovery. */
async function mutate<T>(
  port: EmployeeExperiencePort,
  pendingBySemantic: Map<string, PendingMutation<T>>,
  semanticKey: string,
  actions: CloudActions,
  createOperationId: OperationIdFactory,
  replay: (operationId: OperationId) => Promise<ProductResult<T>>,
): Promise<MutationOutcome<T>> {
  actions.setBusy(true)
  actions.setError(null)
  try {
    const retained = pendingBySemantic.get(semanticKey)
    if (retained !== undefined) {
      return await reconcileCloudMutation(
        port,
        pendingBySemantic,
        semanticKey,
        retained,
        actions,
        true,
      )
    }
    const operationId = createOperationId()
    const pending: PendingMutation<T> = { operationId, replay: () => replay(operationId) }
    pendingBySemantic.set(semanticKey, pending)
    return await executeCloudMutation(
      port,
      pendingBySemantic,
      semanticKey,
      pending,
      actions,
      true,
    )
  } finally {
    actions.setBusy(false)
  }
}

/**
 * Bind the explicit production service and object-layer external store to
 * plain component callbacks. No callback imports a Cloud SDK or Fixture port.
 * @param port - explicit production Employee Experience service.
 * @param externalStore - stable projection reference bridge.
 * @param actions - transient Slot Store actions.
 * @param createOperationId - one-id-per-mutation factory.
 * @returns component callbacks and the object-layer snapshot hook.
 */
export function createCloudWorkbenchInjected(
  port: EmployeeExperiencePort,
  externalStore: EmployeeExperienceExternalStore,
  actions: CloudActions,
  createOperationId: OperationIdFactory = browserOperationId,
): CloudWorkbenchInjected {
  const openOperations = new Map<string, PendingMutation<EngagementView>>()
  const submitOperations = new Map<string, PendingMutation<ActivityView>>()
  const responseOperations = new Map<string, PendingMutation<EffectReceiptView>>()
  const materialOperations = new Map<string, PendingMutation<MaterialAccessGrant>>()

  return {
    useExperience: () => useEmployeeExperience(externalStore),
    openEngagement: async (employeeRef: EmployeeRef) => {
      const result = await mutate(
        port,
        openOperations,
        employeeRef,
        actions,
        createOperationId,
        operationId => port.openEngagement({ operation_id: operationId, employee_ref: employeeRef }),
      )
      if (result.ok) actions.selectEngagement(result.value.engagement_ref)
      if (!result.ok && !result.recovered) return false
      const engagementRef = result.ok
        ? result.value.engagement_ref
        : externalStore.getSnapshot().current_engagement?.engagement.engagement_ref
      if (engagementRef === undefined) return true
      actions.selectEngagement(engagementRef)
      const detail = await port.readEngagement({ engagement_ref: engagementRef })
      if (!detail.ok) showError(detail.error, actions)
      return detail.ok
    },
    selectEngagement: async (engagementRef: EngagementRef) => {
      actions.selectEngagement(engagementRef)
      try {
        const result = await port.readEngagement({ engagement_ref: engagementRef })
        if (!result.ok) showError(result.error, actions)
        return result.ok
      } catch {
        actions.setError('无法读取协作内容，请稍后重试。')
        return false
      }
    },
    submitText: async (
      engagementRef: EngagementRef,
      text: string,
      expectedRevision: OwnerRevision,
    ) => {
      const semanticKey = JSON.stringify([engagementRef, text, expectedRevision])
      const result = await mutate(
        port,
        submitOperations,
        semanticKey,
        actions,
        createOperationId,
        operationId => port.submitInput({
          operation_id: operationId,
          engagement_ref: engagementRef,
          parts: [{ kind: 'text', text }],
          expected_revision: expectedRevision,
        }),
      )
      if (result.ok || result.recovered) actions.setDraft('')
      return result.ok || result.recovered
    },
    respondInteraction: async (
      interactionRef: InteractionRef,
      outcomeId: string,
      expectedRevision: OwnerRevision,
      values?: JsonValue,
    ) => {
      const result = await mutate(
        port,
        responseOperations,
        interactionRef,
        actions,
        createOperationId,
        operationId => port.respondInteraction({
          operation_id: operationId,
          interaction_ref: interactionRef,
          outcome_id: outcomeId,
          ...(values !== undefined ? { values } : {}),
          expected_revision: expectedRevision,
        }),
      )
      return result.ok || result.recovered
    },
    requestMaterialAccess: async (
      materialRef: MaterialRef,
      action: 'preview' | 'download',
      expectedRevision: OwnerRevision,
    ) => {
      const semanticKey = JSON.stringify([materialRef, action, expectedRevision])
      const result = await mutate(
        port,
        materialOperations,
        semanticKey,
        actions,
        createOperationId,
        operationId => port.createMaterialAccess({
          operation_id: operationId,
          material_ref: materialRef,
          action,
          purpose: action === 'preview' ? '用户预览员工产出' : '用户下载员工产出',
          expected_revision: expectedRevision,
        }),
      )
      return result.ok || result.recovered
    },
  }
}

async function reconcileLocalPending(
  port: LocalCapabilityPort,
  interactionRef: InteractionRef,
  pending: LocalPendingMutation,
  uncertainByInteraction: Map<InteractionRef, LocalPendingMutation>,
  actions: CloudActions,
  replayOnNotFound: boolean,
): Promise<LocalMutationOutcome> {
  const state = await reconcile(port, pending.operationId, actions, LOCAL_RECONCILIATION_MESSAGES)
  switch (state) {
    case 'settled_success':
      uncertainByInteraction.delete(interactionRef)
      return { kind: pending.kind, succeeded: true }
    case 'settled_failure':
      uncertainByInteraction.delete(interactionRef)
      return { kind: pending.kind, succeeded: false }
    case 'pending':
      return { kind: pending.kind, succeeded: false }
    case 'not_found':
      if (!replayOnNotFound) {
        actions.setError(LOCAL_RECONCILIATION_MESSAGES.pending)
        return { kind: pending.kind, succeeded: false }
      }
      return executeLocalMutation(
        port,
        interactionRef,
        pending,
        uncertainByInteraction,
        actions,
        false,
      )
  }
}

async function executeLocalMutation(
  port: LocalCapabilityPort,
  interactionRef: InteractionRef,
  pending: LocalPendingMutation,
  uncertainByInteraction: Map<InteractionRef, LocalPendingMutation>,
  actions: CloudActions,
  replayOnNotFound: boolean,
): Promise<LocalMutationOutcome> {
  let result: ProductResult<unknown>
  try {
    result = await pending.replay()
  } catch {
    return reconcileLocalPending(
      port,
      interactionRef,
      pending,
      uncertainByInteraction,
      actions,
      replayOnNotFound,
    )
  }
  if (result.ok) {
    uncertainByInteraction.delete(interactionRef)
    actions.setError(null)
    return { kind: pending.kind, succeeded: true }
  }
  if (result.error.code !== 'UNKNOWN_OUTCOME') {
    uncertainByInteraction.delete(interactionRef)
    showError(result.error, actions)
    return { kind: pending.kind, succeeded: false }
  }
  return reconcileLocalPending(
    port,
    interactionRef,
    pending,
    uncertainByInteraction,
    actions,
    replayOnNotFound,
  )
}

async function refreshAuthorizedExperience(
  refreshExperience: ExperienceRefresh,
  actions: CloudActions,
): Promise<boolean> {
  try {
    const refreshed = await refreshExperience()
    if (refreshed.ok) return true
    showError(refreshed.error, actions)
    return false
  } catch {
    actions.setError('本地操作已完成，但无法刷新 AI 员工协作，请稍后重试。')
    return false
  }
}

/**
 * Bind an optional Client-side Local Capability service to path-free UI callbacks.
 * The closure retains an uncertain operation identity and exact replay only until settlement.
 * @param port - explicit optional Local Capability service.
 * @param externalStore - complete path-free Local Capability projection.
 * @param actions - transient Slot Store actions for busy and display-safe errors.
 * @param refreshExperience - explicit current-engagement refresh after authorization settlement.
 * @param createOperationId - one-id-per-mutation factory.
 * @returns optional local operation callbacks and snapshot hook.
 */
export function createLocalCapabilityWorkbenchInjected(
  port: LocalCapabilityPort,
  externalStore: LocalCapabilityExternalStore,
  actions: CloudActions,
  refreshExperience: ExperienceRefresh,
  createOperationId: OperationIdFactory = browserOperationId,
): LocalCapabilityWorkbenchInjected {
  const uncertainByInteraction = new Map<InteractionRef, LocalPendingMutation>()

  const invoke = async (
    interactionRef: InteractionRef,
    kind: LocalMutationKind,
    mutation: (operationId: OperationId) => Promise<ProductResult<unknown>>,
  ): Promise<LocalMutationOutcome> => {
    actions.setBusy(true)
    actions.setError(null)
    try {
      const retained = uncertainByInteraction.get(interactionRef)
      if (retained !== undefined) {
        return await reconcileLocalPending(
          port,
          interactionRef,
          retained,
          uncertainByInteraction,
          actions,
          true,
        )
      }
      const operationId = createOperationId()
      const pending: LocalPendingMutation = {
        kind,
        operationId,
        replay: () => mutation(operationId),
      }
      uncertainByInteraction.set(interactionRef, pending)
      return await executeLocalMutation(
        port,
        interactionRef,
        pending,
        uncertainByInteraction,
        actions,
        true,
      )
    } finally {
      actions.setBusy(false)
    }
  }

  return {
    useLocalCapability: () => useLocalCapability(externalStore),
    selectDirectory: async (interactionRef, slotRef) => {
      const result = await invoke(
        interactionRef,
        'select',
        operationId => port.selectDirectory({
          interaction_ref: interactionRef,
          slot_ref: slotRef,
          operation_id: operationId,
        }),
      )
      return result.succeeded
    },
    authorizeLocalOperation: async (
      interactionRef: InteractionRef,
      grantHandle: LocalResourceView['grant_handle'],
      expectedInteractionRevision: OwnerRevision,
      expectedResourceRevision: LocalResourceView['revision'],
    ) => {
      const result = await invoke(
        interactionRef,
        'authorize',
        operationId => port.authorizeLocalOperation({
          interaction_ref: interactionRef,
          grant_handle: grantHandle,
          expected_interaction_revision: expectedInteractionRevision,
          expected_resource_revision: expectedResourceRevision,
          operation_id: operationId,
        }),
      )
      if (!result.succeeded || result.kind !== 'authorize') return false
      return refreshAuthorizedExperience(refreshExperience, actions)
    },
    reconcileLocalOperation: async (interactionRef) => {
      const pending = uncertainByInteraction.get(interactionRef)
      if (pending === undefined) {
        actions.setError('当前没有需要查询的本地操作。')
        return false
      }
      actions.setBusy(true)
      try {
        const result = await reconcileLocalPending(
          port,
          interactionRef,
          pending,
          uncertainByInteraction,
          actions,
          true,
        )
        if (!result.succeeded || result.kind !== 'authorize') return result.succeeded
        return await refreshAuthorizedExperience(refreshExperience, actions)
      } finally {
        actions.setBusy(false)
      }
    },
  }
}
