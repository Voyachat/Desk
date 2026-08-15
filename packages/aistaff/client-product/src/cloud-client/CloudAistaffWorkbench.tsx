import type {
  ActivityView,
  EmployeeCard,
  EmployeeExperienceSnapshot,
  InteractionRequestView,
  JsonValue,
  MaterialBody,
  MaterialView,
} from '@deepseek-ai/dsh-aistaff-employee-experience'
import type {
  LocalCapabilitySnapshot,
  LocalResourceView,
} from '@deepseek-ai/dsh-aistaff-local-capability'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useEffect, useState, type FormEvent } from 'react'
import css from '../client/AistaffProduct.module.css'
import type { createCloudProductStore } from './store.ts'

type EmployeeRef = ReturnType<typeof import('@deepseek-ai/dsh-aistaff-employee-experience').EmployeeRef>
type EngagementRef = ReturnType<typeof import('@deepseek-ai/dsh-aistaff-employee-experience').EngagementRef>
type InteractionRef = ReturnType<typeof import('@deepseek-ai/dsh-aistaff-employee-experience').InteractionRef>
type MaterialRef = ReturnType<typeof import('@deepseek-ai/dsh-aistaff-employee-experience').MaterialRef>
type OwnerRevision = ReturnType<typeof import('@deepseek-ai/dsh-aistaff-employee-experience').OwnerRevision>

/** Plain callbacks supplied by the explicit production service adapter. */
export interface CloudWorkbenchInjected {
  /** React external-store read of the object-layer projection. */
  useExperience: () => EmployeeExperienceSnapshot
  /** Open one collaboration with the selected employee. */
  openEngagement: (employeeRef: EmployeeRef) => Promise<boolean>
  /** Load one existing collaboration into the object layer. */
  selectEngagement: (engagementRef: EngagementRef) => Promise<boolean>
  /** Submit one text input using the owner revision shown to the user. */
  submitText: (engagementRef: EngagementRef, text: string, expectedRevision: OwnerRevision) => Promise<boolean>
  /** Send one owner-advertised interaction outcome. */
  respondInteraction: (
    interactionRef: InteractionRef,
    outcomeId: string,
    expectedRevision: OwnerRevision,
    values?: JsonValue,
  ) => Promise<boolean>
  /** Request controlled preview or download metadata. */
  requestMaterialAccess: (
    materialRef: MaterialRef,
    action: 'preview' | 'download',
    expectedRevision: OwnerRevision,
  ) => Promise<boolean>
  /** Optional Client-side local capability bridge; absent preserves Cloud-only mode. */
  readonly localCapability?: LocalCapabilityWorkbenchInjected
}

/** Optional path-free callbacks supplied only when Local Capability is mounted. */
export interface LocalCapabilityWorkbenchInjected {
  /** React external-store read of complete Local Capability replacements. */
  readonly useLocalCapability: () => LocalCapabilitySnapshot
  /** Open the trusted native directory chooser for one authoritative slot. */
  readonly selectDirectory: (interactionRef: InteractionRef, slotRef: string) => Promise<boolean>
  /** Capture Local Consent and dispatch the current authoritative read. */
  readonly authorizeLocalOperation: (
    interactionRef: InteractionRef,
    grantHandle: LocalResourceView['grant_handle'],
    expectedInteractionRevision: OwnerRevision,
    expectedResourceRevision: LocalResourceView['revision'],
  ) => Promise<boolean>
  /** Reconcile one uncertain local operation with its retained original identity. */
  readonly reconcileLocalOperation: (interactionRef: InteractionRef) => Promise<boolean>
}

/** Complete props for the Cloud AI employee workbench. */
export type CloudAistaffWorkbenchProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createCloudProductStore>>
  & CloudWorkbenchInjected

function employeeStatus(status: EmployeeCard['availability']): string {
  switch (status) {
    case 'ready': return '可用'
    case 'busy': return '忙碌'
    case 'offline': return '离线'
    case 'unknown': return '状态未知'
  }
}

function activityStatus(status: ActivityView['display_state']): string {
  switch (status) {
    case 'queued': return '已排队'
    case 'working': return '处理中'
    case 'waiting_user': return '等待你的回复'
    case 'succeeded': return '已完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    case 'unknown': return '状态待确认'
  }
}

function riskLabel(risk: 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'low': return '低风险'
    case 'medium': return '中风险'
    case 'high': return '高风险'
    case 'critical': return '严重风险'
  }
}

function outcomeLabel(outcomeId: string): string {
  switch (outcomeId) {
    case 'approve': return '批准'
    case 'reject': return '拒绝'
    case 'confirm': return '确认'
    case 'cancel': return '取消'
    default: return outcomeId
  }
}

function resourceKindLabel(
  kind: Extract<InteractionRequestView, { readonly kind: 'local_operation' }>['resource_requirements'][number]['resource_kind'],
): string {
  switch (kind) {
    case 'file': return '文件'
    case 'directory': return '目录'
    case 'browser_context': return '浏览器上下文'
    case 'clipboard': return '剪贴板'
    case 'local_process': return '本机进程'
    case 'mcp_server': return 'MCP 服务'
    case 'device_sensor': return '设备传感器'
  }
}

function resourceStateLabel(state: LocalResourceView['state']): string {
  switch (state) {
    case 'active': return '可使用'
    case 'expired': return '已过期'
    case 'revoked': return '已撤销'
  }
}

function consentStateLabel(state: LocalCapabilitySnapshot['consents'][number]['state']): string {
  switch (state) {
    case 'pending': return '等待本地允许'
    case 'authorized': return '本次已允许'
    case 'denied': return '已拒绝'
    case 'expired': return '已过期'
    case 'revoked': return '已撤销'
  }
}

function stateMessage(snapshot: EmployeeExperienceSnapshot): string | null {
  switch (snapshot.state) {
    case 'ready': return null
    case 'loading': return '正在同步 AI 员工…'
    case 'signed_out': return '登录后可使用云端 AI 员工。'
    case 'device_registration_required': return '需要先完成此设备的企业注册。'
    case 'degraded': return snapshot.error?.message ?? '部分员工数据暂时不可用。'
    case 'update_required': return '当前客户端版本无法使用这组 AI 员工，请先升级。'
  }
}

function assertNever(value: never): never {
  throw new Error(`unsupported Renderer-safe value ${JSON.stringify(value)}`)
}

/** Render one admitted material body without raw HTML or active external content. */
function MaterialBodyView({ body }: { readonly body: MaterialBody }) {
  switch (body.kind) {
    case 'text':
      return <div className={css.materialText} data-format={body.format}>{body.text}</div>
    case 'structured':
      return <pre className={css.structured}>{JSON.stringify(body.value, null, 2)}</pre>
    case 'artifact':
      return (
        <p className={css.materialMeta}>
          文件 · {body.media_type} · {body.byte_size.toLocaleString()} bytes
        </p>
      )
    case 'link':
      return (
        <p className={css.materialMeta}>
          外部链接：{body.label}（{body.url}）
        </p>
      )
    default:
      return assertNever(body)
  }
}

interface MaterialCardProps {
  readonly material: MaterialView
  readonly busy: boolean
  readonly requestMaterialAccess: CloudWorkbenchInjected['requestMaterialAccess']
}

/** Render one Material and controlled access actions. */
function MaterialCard({ material, busy, requestMaterialAccess }: MaterialCardProps) {
  const canPreview = material.allowed_actions.preview?.allowed === true
  const canDownload = material.allowed_actions.download?.allowed === true
  return (
    <article className={css.materialCard}>
      <div className={css.cardHeading}>
        <strong>{material.title}</strong>
        <span className={css.status} data-status={material.state}>{material.state === 'available' ? '可用' : '不可用'}</span>
      </div>
      {material.summary !== undefined && <p className={css.materialSummary}>{material.summary}</p>}
      <MaterialBodyView body={material.body} />
      {(canPreview || canDownload) && (
        <div className={css.approvalActions}>
          {canPreview && (
            <button
              type="button"
              className={css.secondary}
              disabled={busy}
              onClick={() => { void requestMaterialAccess(material.material_ref, 'preview', material.revision) }}
            >预览</button>
          )}
          {canDownload && (
            <button
              type="button"
              className={css.secondary}
              disabled={busy}
              onClick={() => { void requestMaterialAccess(material.material_ref, 'download', material.revision) }}
            >下载</button>
          )}
        </div>
      )}
    </article>
  )
}

interface InteractionCardProps {
  readonly interaction: InteractionRequestView
  readonly busy: boolean
  readonly respond: CloudWorkbenchInjected['respondInteraction']
  readonly localCapability?: LocalCapabilityWorkbenchInjected
}

interface LocalOperationCardProps {
  readonly interaction: Extract<InteractionRequestView, { readonly kind: 'local_operation' }>
  readonly busy: boolean
  readonly respond: CloudWorkbenchInjected['respondInteraction']
  readonly localCapability: LocalCapabilityWorkbenchInjected
}

/** Render one optional path-free Local Consent flow over the authoritative interaction. */
function LocalOperationCard({ interaction, busy, respond, localCapability }: LocalOperationCardProps) {
  const snapshot = localCapability.useLocalCapability()
  const ownerOutcomes = interaction.allowed_outcome_ids.filter(outcome =>
    outcome === 'deny' || outcome === 'reject' || outcome === 'cancel')
  const receipts = snapshot.receipts.filter(receipt => receipt.subject_ref === interaction.interaction_ref)

  return (
    <article className={css.localOperationCard}>
      <div className={css.cardHeading}>
        <div>
          <strong>{interaction.title}</strong>
          <p className={css.interactionOwner}>本机只读 · 独立 Local Consent</p>
        </div>
        <span className={css.risk} data-risk={interaction.risk}>{riskLabel(interaction.risk)}</span>
      </div>
      <p className={css.interactionSummary}>{interaction.summary}</p>
      {snapshot.state === 'unavailable' && (
        <p className={css.disabledNotice}>本机能力当前不可用，请稍后重试。</p>
      )}
      <div className={css.localSlots}>
        {interaction.resource_requirements.map(requirement => {
          const consent = snapshot.consents.find(value =>
            value.interaction_ref === interaction.interaction_ref && value.slot_ref === requirement.slot_ref)
          const resource = consent === undefined
            ? undefined
            : snapshot.resources.find(value => value.grant_handle === consent.grant_handle)
          const supported = requirement.resource_kind === 'directory' && requirement.access === 'read'
          return (
            <section className={css.localSlot} key={requirement.slot_ref}>
              <div className={css.localSlotHeading}>
                <span>{resourceKindLabel(requirement.resource_kind)} · {requirement.access === 'read' ? '只读' : requirement.access}</span>
                {resource !== undefined && (
                  <span className={css.status} data-status={resource.state}>{resourceStateLabel(resource.state)}</span>
                )}
              </div>
              {resource === undefined ? (
                <button
                  type="button"
                  className={css.secondary}
                  disabled={busy || snapshot.state !== 'ready' || !supported}
                  onClick={() => { void localCapability.selectDirectory(interaction.interaction_ref, requirement.slot_ref) }}
                >{supported ? '选择目录' : '暂不支持此资源'}</button>
              ) : (
                <div className={css.localResource}>
                  <strong>{resource.display_name}</strong>
                  <span>有效期至 <time dateTime={resource.expires_at}>{new Date(resource.expires_at).toLocaleString()}</time></span>
                  {consent !== undefined && <span>Local Consent：{consentStateLabel(consent.state)}</span>}
                  {consent?.state === 'pending' && resource.state === 'active' && (
                    <button
                      type="button"
                      className={css.primary}
                      disabled={busy}
                      onClick={() => {
                        void localCapability.authorizeLocalOperation(
                          interaction.interaction_ref,
                          resource.grant_handle,
                          interaction.revision,
                          resource.revision,
                        )
                      }}
                    >允许本次只读</button>
                  )}
                  {consent?.state === 'authorized' && receipts.length === 0 && (
                    <button
                      type="button"
                      className={css.secondary}
                      disabled={busy}
                      onClick={() => { void localCapability.reconcileLocalOperation(interaction.interaction_ref) }}
                    >查询本次结果</button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
      {receipts.map(receipt => (
        <div className={css.localReceipt} data-status={receipt.status} key={receipt.receipt_ref}>
          <strong>本地回执：{receipt.status === 'succeeded' ? '已完成' : receipt.status === 'unknown' ? '结果待确认' : '未完成'}</strong>
          <span>{receipt.reason_code ?? `效果状态：${receipt.effect_state}`}</span>
          {receipt.result_material_refs.length > 0 && <span>关联产出：{receipt.result_material_refs.join('、')}</span>}
        </div>
      ))}
      {ownerOutcomes.length > 0 && (
        <div className={css.approvalActions}>
          {ownerOutcomes.map(outcomeId => (
            <button
              type="button"
              className={css.secondary}
              disabled={busy}
              key={outcomeId}
              onClick={() => { void respond(interaction.interaction_ref, outcomeId, interaction.revision) }}
            >{outcomeLabel(outcomeId)}</button>
          ))}
        </div>
      )}
    </article>
  )
}

/** Render owner-advertised Input/Approval interactions and optional local operations. */
function InteractionCard({ interaction, busy, respond, localCapability }: InteractionCardProps) {
  const [input, setInput] = useState('')
  switch (interaction.kind) {
    case 'approval':
      return (
        <article className={css.card}>
          <div className={css.cardHeading}>
            <div>
              <strong>{interaction.title}</strong>
              <p className={css.interactionOwner}>企业审批 · Cloud</p>
            </div>
            <span className={css.risk} data-risk={interaction.risk}>{riskLabel(interaction.risk)}</span>
          </div>
          <p className={css.interactionSummary}>{interaction.summary}</p>
          <div className={css.approvalActions}>
            {interaction.allowed_outcome_ids.map(outcomeId => (
              <button
                type="button"
                className={outcomeId === 'approve' || outcomeId === 'confirm' ? css.primary : css.secondary}
                disabled={busy}
                key={outcomeId}
                onClick={() => { void respond(interaction.interaction_ref, outcomeId, interaction.revision) }}
              >{outcomeLabel(outcomeId)}</button>
            ))}
          </div>
        </article>
      )
    case 'input':
      return (
        <article className={css.card}>
          <strong>{interaction.title}</strong>
          <p className={css.interactionSummary}>{interaction.summary}</p>
          <label className={css.field}>
            <span>回复</span>
            <input
              value={input}
              disabled={busy}
              onChange={event => { setInput(event.currentTarget.value) }}
            />
          </label>
          <div className={css.approvalActions}>
            {interaction.allowed_outcome_ids.map(outcomeId => (
              <button
                type="button"
                className={css.primary}
                disabled={busy || input.trim() === ''}
                key={outcomeId}
                onClick={() => {
                  const value = input.trim()
                  if (value !== '') void respond(interaction.interaction_ref, outcomeId, interaction.revision, value)
                }}
              >{outcomeLabel(outcomeId)}</button>
            ))}
          </div>
        </article>
      )
    case 'local_operation':
      if (localCapability !== undefined) {
        return (
          <LocalOperationCard
            interaction={interaction}
            busy={busy}
            respond={respond}
            localCapability={localCapability}
          />
        )
      }
      return (
        <article className={css.card} aria-disabled="true">
          <strong>{interaction.title}</strong>
          <p className={css.interactionSummary}>{interaction.summary}</p>
          <p className={css.disabledNotice}>当前 Cloud-only 模式不允许执行本机操作。</p>
        </article>
      )
    default:
      return assertNever(interaction)
  }
}

/** Render the formal Cloud employee vertical flow inside the existing DSH overlay. */
export function CloudAistaffWorkbench({
  useStore,
  actions,
  useExperience,
  openEngagement,
  selectEngagement,
  submitText,
  respondInteraction,
  requestMaterialAccess,
  localCapability,
}: CloudAistaffWorkbenchProps) {
  const state = useStore(value => value)
  const snapshot = useExperience()
  const employees = snapshot.workforce?.employees ?? []
  const selectedEmployee = employees.find(value => value.employee_ref === state.selectedEmployeeRef)
  const employeeEngagements = snapshot.engagements.filter(value => value.employee_ref === state.selectedEmployeeRef)
  const selectedEngagement = employeeEngagements.find(value => value.engagement_ref === state.selectedEngagementRef)
  const detail = snapshot.current_engagement?.engagement.engagement_ref === state.selectedEngagementRef
    ? snapshot.current_engagement
    : null

  useEffect(() => {
    if (employees.length === 0) return
    if (selectedEmployee === undefined) actions.selectEmployee(employees[0]!.employee_ref)
  }, [actions, employees, selectedEmployee])

  useEffect(() => {
    if (selectedEmployee === undefined) return
    if (selectedEngagement !== undefined) return
    const first = employeeEngagements[0]
    if (first !== undefined) void selectEngagement(first.engagement_ref)
  }, [employeeEngagements, selectEngagement, selectedEmployee, selectedEngagement])

  if (!state.open) return null

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = state.draft.trim()
    if (selectedEngagement === undefined || text === '' || state.busy) return
    void submitText(selectedEngagement.engagement_ref, text, selectedEngagement.revision)
  }
  const status = stateMessage(snapshot)
  const activities = detail === null ? [] : [...detail.activities].reverse()
  const materials = detail === null ? [] : [...detail.materials].reverse()
  const interactions = detail === null ? [] : detail.interactions
  const receipts = detail === null ? [] : [...detail.receipts].reverse()

  return (
    <aside className={css.workbench} role="dialog" aria-modal="false" aria-labelledby="aistaff-cloud-workbench-title">
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>企业 AI 员工</p>
          <h2 id="aistaff-cloud-workbench-title" className={css.title}>AI 员工</h2>
        </div>
        <button type="button" className={css.close} aria-label="关闭 AI 员工工作台" onClick={actions.closeWorkbench}>×</button>
      </header>

      {status !== null && <p className={css.stateNotice} role="status">{status}</p>}
      {state.error !== null && <p className={css.error} role="alert">{state.error}</p>}

      <section className={css.section} aria-labelledby="aistaff-cloud-employee-title">
        <h3 id="aistaff-cloud-employee-title" className={css.sectionTitle}>选择员工</h3>
        <label className={css.field}>
          <span>AI 员工</span>
          <select
            value={state.selectedEmployeeRef ?? ''}
            disabled={state.busy || snapshot.state !== 'ready' || employees.length === 0}
            onChange={event => { actions.selectEmployee(event.currentTarget.value as EmployeeRef) }}
          >
            {employees.map(employee => (
              <option
                key={employee.employee_ref}
                value={employee.employee_ref}
                disabled={employee.availability !== 'ready' || employee.allowed_actions.open?.allowed === false}
              >
                {employee.display_name} · {employeeStatus(employee.availability)}
              </option>
            ))}
          </select>
        </label>
        {selectedEmployee !== undefined && (
          <>
            <p className={css.employeeRole}>{selectedEmployee.role_label}</p>
            {selectedEmployee.description !== undefined && <p className={css.employeeDescription}>{selectedEmployee.description}</p>}
          </>
        )}
      </section>

      <section className={css.section} aria-labelledby="aistaff-cloud-engagement-title">
        <div className={css.sectionHeading}>
          <h3 id="aistaff-cloud-engagement-title" className={css.sectionTitle}>协作</h3>
          <button
            type="button"
            className={css.secondary}
            disabled={state.busy || selectedEmployee?.availability !== 'ready'}
            onClick={() => { if (selectedEmployee !== undefined) void openEngagement(selectedEmployee.employee_ref) }}
          >新建协作</button>
        </div>
        <label className={css.field}>
          <span>当前协作</span>
          <select
            value={state.selectedEngagementRef ?? ''}
            disabled={state.busy || employeeEngagements.length === 0}
            onChange={event => { void selectEngagement(event.currentTarget.value as EngagementRef) }}
          >
            {employeeEngagements.length === 0 && <option value="">尚无协作</option>}
            {employeeEngagements.map(engagement => (
              <option key={engagement.engagement_ref} value={engagement.engagement_ref}>{engagement.title}</option>
            ))}
          </select>
        </label>
        <form className={css.form} onSubmit={submit}>
          <label className={css.field}>
            <span>给 AI 员工发送消息</span>
            <textarea
              className={css.textarea}
              value={state.draft}
              disabled={state.busy || selectedEngagement === undefined}
              placeholder="描述你希望 AI 员工完成的工作"
              onChange={event => { actions.setDraft(event.currentTarget.value) }}
            />
          </label>
          <button
            type="submit"
            className={css.primary}
            disabled={state.busy || selectedEngagement === undefined || state.draft.trim() === ''}
          >{state.busy ? '提交中…' : '发送'}</button>
        </form>
      </section>

      <section className={css.section} aria-labelledby="aistaff-cloud-activity-title">
        <h3 id="aistaff-cloud-activity-title" className={css.sectionTitle}>活动</h3>
        {activities.length === 0 && <p className={css.empty}>发送消息后，员工活动会显示在这里</p>}
        <div className={css.stack}>
          {activities.map(activity => (
            <article key={activity.activity_ref} className={css.taskRow}>
              <strong>员工活动</strong>
              <span className={css.status} data-status={activity.display_state}>{activityStatus(activity.display_state)}</span>
            </article>
          ))}
        </div>
      </section>

      <section className={css.section} aria-labelledby="aistaff-cloud-material-title">
        <h3 id="aistaff-cloud-material-title" className={css.sectionTitle}>产出物料</h3>
        {materials.length === 0 && <p className={css.empty}>员工完成工作后，安全物料会显示在这里</p>}
        <div className={css.stack}>
          {materials.map(material => (
            <MaterialCard
              key={material.material_ref}
              material={material}
              busy={state.busy}
              requestMaterialAccess={requestMaterialAccess}
            />
          ))}
        </div>
      </section>

      <section className={css.section} aria-labelledby="aistaff-cloud-interaction-title">
        <div className={css.sectionHeading}>
          <h3 id="aistaff-cloud-interaction-title" className={css.sectionTitle}>待处理</h3>
          <span className={css.count}>{interactions.length}</span>
        </div>
        {interactions.length === 0 && <p className={css.empty}>当前没有需要你处理的请求</p>}
        <div className={css.stack}>
          {interactions.map(interaction => (
            <InteractionCard
              key={interaction.interaction_ref}
              interaction={interaction}
              busy={state.busy}
              respond={respondInteraction}
              {...(localCapability === undefined ? {} : { localCapability })}
            />
          ))}
        </div>
      </section>

      <section className={css.section} aria-labelledby="aistaff-cloud-receipt-title">
        <h3 id="aistaff-cloud-receipt-title" className={css.sectionTitle}>回执</h3>
        {receipts.length === 0 && <p className={css.empty}>操作完成后，权威回执会显示在这里</p>}
        <div className={css.stack}>
          {receipts.map(receipt => (
            <article key={receipt.receipt_ref} className={css.receipt} data-status={receipt.status}>
              <strong>{receipt.status === 'succeeded' ? '已完成' : receipt.status === 'accepted' ? '已接受' : '未完成'}</strong>
              <span>{receipt.reason_code ?? `效果状态：${receipt.effect_state}`}</span>
            </article>
          ))}
        </div>
      </section>
    </aside>
  )
}
