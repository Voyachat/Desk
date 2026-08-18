# AiDesktop API

> Owner：Host/Supervisor↔Aistaff Client Gateway、Renderer↔Host、Host↔Supervisor 与 Host↔DSH 的端口、最小 DTO、错误语义和版本策略；其他文档只引用，不另定义这些接口。
>
> 进程职责见 [架构](./架构.md)；持久化与事务见 [数据](./数据.md)；阶段见 [构建索引](./构建方案.md)。

## 1. 通用规则

- 每个跨进程 ID 都是不透明字符串；调用方不得解析、拼接或用一种 ID 代替另一种 ID。
- 每个命令带调用方生成的 `operation_id`/`idempotency_key`；只有修改既有 revisioned subject 的命令再带 owner 提供的 `expected_revision`。Effect claim/receipt 还要带稳定 `effect_key`，设备能力快照使用单调 generation。冲突先重读，不覆盖。
- 时间使用 UTC RFC 3339；进入 Aistaff canonical hash 的整数遵守其 JavaScript safe-integer 约束。
- 写请求与可执行载荷只接受协商版本已声明的字段；新客户端必须按服务端选中的版本降级发送。响应读取方忽略未知可选字段；未知必选 variant、未知非 `ignorable` 事件、未知版本、超限 frame、过期身份和 tenant/session 不一致均拒绝。
- Renderer 错误只包含稳定 code、可展示 message 和 `retryable`；绝对路径、Secret、原始 frame、proof、stack 和下游响应正文不得出现。
- 状态订阅发送完整对象替换事件和 owner-ordered opaque cursor；资源 revision 默认只做相等/CAS，不能比较大小。同一 `ProjectionSnapshotLease` 下的全部基线必须返回同一个提交切点的 `stream_ref/resume_cursor`，完整换入后从该 cursor 继续；内存队列不是事实源。

Renderer 与 Host 使用共同结果形式：

```ts
type ProductResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ProductError }

interface ProductError {
  code:
    | 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN'
    | 'NOT_FOUND' | 'CONFLICT' | 'EXPIRED' | 'DENIED'
    | 'UNAVAILABLE' | 'VERSION_MISMATCH' | 'UNKNOWN_OUTCOME'
  message: string
  retryable: boolean
}
```

业务拒绝返回 `ProductResult` 的 error 分支；载体断开可以抛出 transport error，但适配层必须投影为 `UNAVAILABLE`，不能把异常文本直接送给 Renderer。

## 2. Aistaff AI 员工客户端合同

客户端合同不复制 Aistaff 的 Run、Step、Decision 或 Artifact 状态机。它只稳定表达五类用户可见资源：AI 员工、协作空间、一次工作活动、产出物料和待用户处理的交互请求。Aistaff Cloud 继续运行核心 Runtime 并拥有企业事实；只有服务端已签名分配、设备已声明支持、用户与本机策略都允许的 Runtime 或 capability 才能在客户端运行。

### 2.1 稳定语义与版本

产品类型使用稳定名称，不在每个 DTO 后附加 `V1`。版本只出现在最外层载体和可独立演进的 Schema 引用上：

```ts
interface ContractRef {
  name: string
  major: number
  minor: number
  schema_ref: string
  schema_hash: string
}

interface SupportedContractRange {
  name: string
  major: number
  minimum_minor: number
  maximum_minor: number
}
```

同一 `major` 内只允许增加可选字段、可忽略事件或经 Feature 协商的新能力；删除、改名、改变默认值、改变权限/副作用语义和新增调用方必须处理的 variant 都要升 `major`。`minor` 只表示调用双方已经协商的加法能力，服务端内部版本和客户端产品版本不参与业务分支。HTTP、Electron IPC 或 Aistaff 现有 `*.v1` wire 可各自版本化，Host adapter 将它们投影为下列稳定语义。

`schema_ref` 是已 pin contract artifact 或已验证 Bundle 内的逻辑标识符，不能是客户端直接请求的任意 URL；`schema_hash` 必须与本地 artifact 精确一致。未知的必选 contract/component 必须拒绝激活；未知的可选展示 Schema 可降级为安全文本或下载。客户端不得执行服务端下发的 HTML、JavaScript、动态插件文本或未经过 Artifact admission 的可执行文件。

`client_version`、`minimum_client_version` 和 `recommended_client_version` 使用 SemVer 2.0.0 precedence；构建 metadata 不参与比较。平台商店 build number、渠道和 OS/arch 是独立字段，不能用字符串字典序比较版本。

### 2.2 Workforce 与不可变员工包

服务端使用 `platform base → industry pack → tenant policy → role profile → employee release → device rollout` 组合源配置，然后编译成一份已解析、内容寻址、已签名的员工包。Aistaff 的 `employee_source_package.v1`、Workforce offering 和内部 `execution_bundle.v1` 都只是服务端来源/运行事实，不直接下发；这里的 `EmployeeBundleManifest` 是面向精确 Subject/Device/AiDesktop audience 的独立编译产物。客户端可显示 provenance，但不再执行继承、覆盖或 latest 解析，避免设备间漂移和跨 Tenant 混合。

```ts
interface WorkforceSnapshot {
  contract: ContractRef
  workforce_ref: string
  issuer_ref: string
  tenant_ref: string
  subject_ref: string
  device_ref: string
  identity_revision: string
  installation_ref?: string
  audience: 'aidesktop'
  snapshot_ref: string
  stream_ref: string
  revision: string
  resume_cursor: string
  issued_at: string
  expires_at: string
  assignments: EmployeeAssignment[]
  snapshot_hash: string
  signature_ref: string
  trust_chain_ref: string
}

type WorkforceView = Omit<WorkforceSnapshot, 'snapshot_ref' | 'stream_ref' | 'resume_cursor'>

interface EmployeeAssignment {
  assignment_ref: string
  issuer_ref: string
  tenant_ref: string
  subject_ref: string
  device_ref: string
  identity_revision: string
  installation_ref?: string
  audience: 'aidesktop'
  employee: EmployeeCard
  industry_refs: string[]
  role_refs: string[]
  release_ref: string
  bundle_ref: string
  bundle_hash: string
  execution: ClientExecutionPolicy
  state: 'active' | 'paused' | 'revoked' | 'incompatible' | 'unknown'
  revision: string
  expires_at: string
}

interface EmployeeCard {
  employee_ref: string
  display_name: string
  role_label: string
  description?: string
  avatar_ref?: string
  availability: 'ready' | 'busy' | 'offline' | 'unknown'
  capability_labels: string[]
  allowed_actions: Record<string, { allowed: boolean; reason_code?: string }>
}

interface ClientExecutionPolicy {
  control_plane: 'cloud'
  client_mode: 'none' | 'capability_only' | 'managed_runtime'
  required_capability_refs: string[]
  runtime?: ClientRuntimeRequirement
  fallback: 'cloud' | 'blocked'
  minimum_client_version: string
}

interface ClientRuntimeRequirement {
  adapter_contract: ContractRef
  runtime_component_ref: string
  admission_ref: string
  isolation_profile_ref: string
  resource_profile_ref: string
}

interface EmployeeBundleManifest {
  contract: ContractRef
  bundle_ref: string
  assignment_ref: string
  issuer_ref: string
  tenant_ref: string
  subject_ref: string
  device_ref: string
  identity_revision: string
  installation_ref?: string
  audience: 'aidesktop'
  assignment_revision: string
  employee_ref: string
  release_ref: string
  manifest_hash: string
  distribution_scope_hash: string
  components: BundleComponent[]
  interaction_contract: ContractRef
  material_contract: ContractRef
  resolved_from: Array<{ kind: string; ref: string; revision: string; content_hash: string }>
  issued_at: string
  expires_at: string
  signature_ref: string
  trust_chain_ref: string
}

interface BundleComponent {
  component_ref: string
  kind:
    | 'employee_config' | 'profile' | 'topology'
    | 'capability_manifest' | 'policy_set'
    | 'presentation' | 'locale' | 'runtime_component'
  schema_ref: string
  audience: Array<'host' | 'renderer' | 'supervisor' | 'runtime'>
  classification: 'presentation' | 'device_confidential' | 'executable'
  content_ref: string
  transport_media_type: string
  transport_byte_size: number
  transport_hash: string
  payload_media_type: string
  payload_byte_size: number
  payload_hash: string
  encoding:
    | { kind: 'identity' }
    | {
        kind: 'jwe_json'
        contract: ContractRef
        key_management: 'ECDH-ES+A256KW'
        content_encryption: 'A256GCM'
        recipient_key_ref: string
      }
  required: boolean
}

interface DistributionSignatureEnvelope {
  contract: ContractRef
  signature_ref: string
  format: 'cose_sign1_detached'
  algorithm: 'EdDSA'
  domain: 'aistaff.workforce' | 'aistaff.employee-bundle-manifest'
  subject_ref: string
  key_ref: string
  signed_payload_hash: string
  value_base64url: string
}

interface DistributionTrustChainEnvelope {
  contract: ContractRef
  trust_chain_ref: string
  format: 'x509_der_chain'
  certificates_base64: string[]
}
```

`client_mode: none` 表示完全云端运行；`capability_only` 表示核心 Runtime 仍在云端，只将经裁决的本地操作交给 Supervisor；`managed_runtime` 才允许启动员工包引用的受管本地 Runtime。只有 `managed_runtime` 可携带 `runtime`，其 `adapter_contract` 由客户端预装适配器实现，例如 DSH；服务端只能从设备声明的适配器交集里分配，不能要求客户端按字符串动态加载新 Runtime。

Tenant、多行业、多角色和员工 Release 可以在服务端由一组源配置文件表达，但下发物必须是面向当前用户、设备和客户端用途编译后的 Device Bundle。只在服务端使用的 Prompt、Provider 配置、拓扑和策略正文不下发；客户端只收到显示、交互 Schema、能力声明、必要的本机策略投影和可选 Runtime 组件。配置组件不得携带 Secret，只能携带 Secret ref；可执行组件必须与普通 JSON/YAML 配置分开签名和 admission，不得以“配置”名义执行任意代码。Host 按 `audience` 解密和投影，Renderer 永远拿不到 `device_confidential` 或 `executable` 原文。

| 模式 | 必须下发 | 明确不下发 |
| --- | --- | --- |
| `none` | Employee presentation/locale、Interaction/Material contract refs、允许动作投影 | Runtime、服务端 Prompt/拓扑、Provider/Secret、完整策略正文 |
| `capability_only` | `none` 全部内容，加 capability manifest、语义 operation Schema、本机策略约束投影 | 核心 Runtime、任意 shell/path/argv/env、服务端 Secret |
| `managed_runtime` | 上述内容，加已签名 Runtime component、预装 adapter contract、admission/isolation/resource refs | 未声明 adapter 的代码、动态插件文本、未签名 executable、服务端凭据 |

客户端以 manifest 为原子激活单位：先验证 Tenant/设备范围、签名、hash、Schema、OS/arch 与 Runtime 兼容性，再下载缺失的内容寻址组件，最后原子切换 active bundle 并上报 Activation Receipt。签名信任锚随 AiDesktop 发布物固定，轮换只能由已有信任锚签出的链完成；`trust_chain_ref` 不能引入任意新根。新包启动失败保留上一已知可用包；撤销和 kill switch 优先于本地缓存。

初始 digest 合同固定 `SHA-256 + RFC 8785 JCS`。`snapshot_hash` 对去除 `snapshot_ref/stream_ref/resume_cursor/snapshot_hash/signature_ref/trust_chain_ref` 的 `WorkforceView` 求 hash；`manifest_hash` 对去除自身 hash、`signature_ref` 和 `trust_chain_ref` 的 manifest 求 hash，结果都是 SHA-256 base64url。`EmployeeAssignment.bundle_hash` 必须等于对应 `EmployeeBundleManifest.manifest_hash`。`DistributionSignatureEnvelope` 与 `DistributionTrustChainEnvelope` 使用上述固定 media contract；签名覆盖 domain separator、digest、issuer、Tenant、Subject、Device、identity revision、Assignment revision 和 expiry。客户端只接受发布物 allowlist 中的算法与内置 trust anchor，证书链按 leaf-first 验到该 anchor；signature/trust endpoint 只返回内容寻址对象，不能重定向到任意 origin。

组件的 `transport_*` 精确描述 `/bundle-components/{content_ref}` 下载到的字节，`payload_*` 描述解密后交给 Schema parser 的字节；`identity` 时两组 hash/size 必须相同。`jwe_json` 的 transport media type 固定为 `application/jose+json`，JWE protected header 必须精确匹配 descriptor 的 key management、content encryption、recipient key 与 manifest/component identity。验证顺序固定为：验证 manifest 签名和 identity binding → 下载且拒绝 redirect → 校验 transport size/hash → 校验 JWE protected header 并解密 → 校验 payload size/hash → 按 `schema_ref/payload_media_type` 严格解析 → 全部必选组件通过后原子激活。任一步失败都不得把密文 hash 当作配置内容 hash 或部分启用 Bundle。

Manifest parser 先读取稳定 component descriptor，再按 `kind/schema_ref` 找 adapter。未知 component 只有 `required: false` 时可验证 hash 后忽略；`required: true` 或标为 `executable` 的未知 component 一律 `VERSION_MISMATCH`，不能因 response forward-open 而绕过激活检查。

### 2.3 三个窄端口

```ts
interface ClientHello {
  client_version: string
  installation_ref: string
  device_ref?: string
  platform: string
  architecture: string
  supported_contracts: SupportedContractRange[]
  supported_runtime_adapters: SupportedContractRange[]
  supported_features: string[]
}

type ClientIdentity =
  | { state: 'signed_out' }
  | { state: 'expired'; tenant_ref?: string; subject_label?: string }
  | {
      state: 'device_registration_required'
      issuer_ref: string
      tenant_ref: string
      subject_ref: string
      identity_revision: string
      registration_nonce: string
      accepted_attestation_contracts: ContractRef[]
      subject_label?: string
    }
  | {
      state: 'ready'
      issuer_ref: string
      tenant_ref: string
      subject_ref: string
      device_ref: string
      identity_revision: string
      subject_label?: string
    }

interface ClientBootstrap {
  contract: ContractRef
  selected_contracts: ContractRef[]
  contract_selection_ref: string
  contract_selection_expires_at: string
  server_build: string
  compatibility: {
    state: 'compatible' | 'upgrade_recommended' | 'upgrade_required' | 'blocked'
    minimum_client_version: string
    recommended_client_version?: string
    update_by?: string
    reason_code?: string
  }
  identity: ClientIdentity
  features: Record<string, 'enabled' | 'read_only' | 'disabled' | 'blocked'>
  event_transport: 'sse'
}

interface DeviceRegistrationInput {
  operation_id: string
  installation_ref: string
  registration_nonce: string
  dpop_public_jwk: { kty: 'EC'; crv: 'P-256'; alg: 'ES256'; use: 'sig'; kid: string; x: string; y: string }
  device_signing_public_jwk: { kty: 'OKP'; crv: 'Ed25519'; alg: 'EdDSA'; use: 'sig'; kid: string; x: string }
  encryption_public_jwk: { kty: 'EC'; crv: 'P-256'; alg: 'ECDH-ES+A256KW'; use: 'enc'; kid: string; x: string; y: string }
  attestation: { contract: ContractRef; nonce: string; value_base64url: string }
}

interface DeviceRegistrationView {
  device_ref: string
  revision: string
  dpop_key_ref: string
  device_signing_key_ref: string
  encryption_key_ref: string
  state: 'ready' | 'blocked'
}

interface DeviceExecutionCredentialRequest {
  operation_id: string
  device_ref: string
  dpop_key_ref: string
}

interface DeviceExecutionCredentialGrant {
  token_type: 'DPoP'
  access_token: string
  audience: 'aistaff-client-execution'
  scope: 'execution.list execution.claim execution.receipt execution.read'
  expires_at: string
}

interface DeviceRecoveryCredentialRequest {
  operation_id: string
  effect_key: string
  dispatch_hash: string
  receipt_contract: ContractRef
  receipt_hash: string
  receipt_signature: DeviceSignatureEnvelope
}

interface DeviceRecoveryCredentialGrant {
  token_type: 'DPoP'
  access_token: string
  audience: 'aistaff-client-receipt-recovery'
  scope: 'execution.receipt execution.read'
  execution_ref: string
  effect_key: string
  receipt_hash: string
  expires_at: string
}

interface ProjectionSnapshotLease {
  snapshot_ref: string
  stream_ref: string
  issuer_ref: string
  tenant_ref: string
  subject_ref: string
  device_ref: string
  identity_revision: string
  resume_cursor: string
  expires_at: string
}

interface CreateProjectionSnapshotInput { operation_id: string }

interface PageInput { cursor?: string; limit: number }
interface Page<T> {
  items: T[]
  next_cursor?: string
  owner_revision: string
}

interface ProjectionPage<T> extends Page<T> {
  snapshot_ref: string
  stream_ref: string
  resume_cursor: string
}

interface EmployeeExperienceSnapshot {
  state: 'loading' | 'signed_out' | 'device_registration_required' | 'ready' | 'degraded' | 'update_required'
  employees: EmployeeCard[]
  engagements: EngagementView[]
  has_more_engagements: boolean
  view_generation: number
  observed_at?: string
  error?: ProductError
}

interface DeviceCapabilitySnapshot {
  operation_id: string
  device_ref: string
  client_version: string
  platform: string
  architecture: string
  capability_refs: string[]
  capability_contracts: SupportedContractRange[]
  runtime_adapters: SupportedContractRange[]
  generation: number
  expected_revision?: string
  snapshot_hash: string
  expires_at: string
  signature: DeviceSignatureEnvelope
}

type DeviceCapabilityWireInput = Omit<DeviceCapabilitySnapshot, 'device_ref'>

interface BundleActivationReceipt {
  operation_id: string
  issuer_ref: string
  tenant_ref: string
  subject_ref: string
  device_ref: string
  identity_revision: string
  assignment_ref: string
  assignment_revision: string
  bundle_ref: string
  bundle_hash: string
  manifest_hash: string
  status: 'activated' | 'rejected' | 'failed' | 'rolled_back'
  reason_code?: string
  recorded_at: string
}

interface WorkforceDistributionPort {
  describe(input: ClientHello): Promise<ProductResult<ClientBootstrap>>
  beginProjectionSnapshot(input: CreateProjectionSnapshotInput): Promise<ProductResult<ProjectionSnapshotLease>>
  resolveWorkforce(input: { snapshot_ref: string }): Promise<ProductResult<WorkforceSnapshot>>
  getBundleManifest(input: { bundle_ref: string }): Promise<ProductResult<EmployeeBundleManifest>>
  getBundleComponent(input: { content_ref: string }): Promise<ProductResult<Uint8Array>>
  reportDeviceCapabilities(input: DeviceCapabilitySnapshot): Promise<ProductResult<EffectReceiptView>>
  reportBundleActivation(input: BundleActivationReceipt): Promise<ProductResult<EffectReceiptView>>
}

interface EmployeeExperiencePort {
  observe(listener: (snapshot: EmployeeExperienceSnapshot) => void): {
    snapshot: EmployeeExperienceSnapshot
    dispose: () => void
  }
  listEngagements(input: PageInput): Promise<ProductResult<Page<EngagementView>>>
  openEngagement(input: OpenEngagementInput): Promise<ProductResult<EngagementView>>
  readEngagement(input: { engagement_ref: string; cursor?: string }): Promise<ProductResult<EngagementSnapshot>>
  submitInput(input: SubmitEmployeeInput): Promise<ProductResult<ActivityView>>
  respondInteraction(input: InteractionResponseInput): Promise<ProductResult<EffectReceiptView>>
  createMaterialAccess(input: MaterialAccessInput): Promise<ProductResult<MaterialAccessGrant>>
  readOperation(input: { operation_id: string }): Promise<ProductResult<OperationStatusView>>
}

interface OpenEngagementInput {
  operation_id: string
  employee_ref: string
  title?: string
}

interface MaterialAccessInput {
  operation_id: string
  material_ref: string
  action: 'preview' | 'download'
  purpose: string
  expected_revision: string
}

interface MaterialAccessGrant {
  grant_ref: string
  material_ref: string
  action: 'preview' | 'download'
  content_ref: string
  media_type: string
  byte_size: number
  content_hash: string
  display_filename?: string
  expires_at: string
}

interface OperationStatusView {
  operation_id: string
  action: string
  subject_ref?: string
  state: 'pending' | 'accepted' | 'succeeded' | 'failed' | 'rejected' | 'unknown'
  receipt_ref?: string
  outcome?:
    | {
        kind: 'result'
        http_status: number
        result_contract: ContractRef
        result: JsonValue
        result_hash: string
      }
    | {
        kind: 'error'
        http_status: number
        code: CloudErrorCode
        message_key: string
        retryable: boolean
        error_hash: string
      }
  idempotency_expires_at?: string
  revision: string
  updated_at: string
}

interface EmployeeClientEvent {
  envelope_contract: ContractRef
  payload_contract: ContractRef
  stream_ref: string
  event_ref: string
  cursor: string
  occurred_at: string
  payload: EmployeeClientEventPayload
}

interface EmployeeEventEnvelope {
  envelope_contract: ContractRef
  payload_contract: ContractRef
  contract_selection_ref: string
  stream_ref: string
  event_ref: string
  cursor: string
  payload_type: string
  ignorable: boolean
  occurred_at: string
  payload: JsonValue
}

type EmployeeClientEventPayload =
  | {
      type: 'projection.reset'
      scope: 'identity'
      reason_code: string
    }
  | { type: 'workforce.changed'; value: WorkforceView }
  | { type: 'engagement.changed'; value: EngagementView }
  | { type: 'activity.changed'; value: ActivityView }
  | { type: 'material.changed'; value: MaterialView }
  | { type: 'interaction.changed'; value: InteractionRequestView }
  | { type: 'receipt.changed'; value: EffectReceiptView }

interface ClientExecutionOffer {
  execution_ref: string
  execution_mode: 'capability_only' | 'managed_runtime'
  revision: string
  deadline_at: string
}

interface ClientExecutionAssignmentBase {
  execution_ref: string
  engagement_ref: string
  activity_ref: string
  bundle_ref: string
  bundle_hash: string
  dispatch_contract: ContractRef
  dispatch_payload: JsonValue
  dispatch_hash: string
  revision: string
  deadline_at: string
}

type ClientExecutionAssignment =
  | ClientExecutionAssignmentBase & {
      execution_mode: 'capability_only'
      capability_ref: string
      executor_contract: ContractRef
    }
  | ClientExecutionAssignmentBase & {
      execution_mode: 'managed_runtime'
      runtime_adapter_contract: ContractRef
    }

interface ClientExecutionReceipt {
  operation_id: string
  effect_key: string
  execution_ref: string
  dispatch_hash: string
  expected_revision: string
  receipt_contract: ContractRef
  receipt_payload: JsonValue
  receipt_hash: string
}

interface ClientExecutionClaimWireInput {
  operation_id: string
  effect_key: string
  expected_revision: string
}

interface ClientExecutionReceiptWireInput {
  operation_id: string
  effect_key: string
  dispatch_hash: string
  expected_revision: string
  receipt_contract: ContractRef
  receipt_payload: JsonValue
  receipt_hash: string
}

interface ClientExecutionStatusView {
  execution_ref: string
  state: 'offered' | 'claimed' | 'running' | 'receipt_pending' | 'succeeded' | 'failed' | 'unknown' | 'closed'
  revision: string
  receipt?: EffectReceiptView
  updated_at: string
}

interface ClientExecutionPort {
  listOffers(input: { cursor?: string; wait_ms?: number }): Promise<ProductResult<Page<ClientExecutionOffer>>>
  claim(input: { operation_id: string; effect_key: string; execution_ref: string; expected_revision: string }): Promise<ProductResult<ClientExecutionAssignment>>
  submitReceipt(input: ClientExecutionReceipt): Promise<ProductResult<EffectReceiptView>>
  reconcile(input: { execution_ref: string }): Promise<ProductResult<EffectReceiptView>>
}
```

`DeviceCapabilitySnapshot.snapshot_hash` 是去除 `snapshot_hash/signature` 后完整 semantic snapshot 的 RFC 8785 JCS SHA-256 base64url；它包含 device、client/platform/architecture、capability/runtime contract ranges、generation、expected revision 和 expiry。`signature.domain` 固定 `aistaff.device-capability`，`subject_ref` 等于 device ref，签名 payload 还绑定当前 `contract_selection_ref`。服务端只接受当前设备登记 signing key 的签名与严格递增 generation，不能使用注册时的 OS attestation ref 代替这次快照证明。

Renderer 只看 `EmployeeExperiencePort` 的纯 DTO；`observe()` 必须由同一 Client object layer 原子注册 listener 并返回当前 snapshot，后续只发布完整 Renderer-safe replacement，因此初始读取与订阅之间没有竞态。业务 projection 留在 object layer，Slot Store 只保存面板开关、选择、草稿、busy/error 等瞬时状态。Product Host 持有 Distribution/Cloud projection adapter，并在内部使用 `snapshot_ref/stream_ref/resume_cursor` 完成同步，Renderer 不参与 checkpoint 编排。Supervisor/受管 Runtime 才能持有 `ClientExecutionPort` adapter。三者不共享 Cloud SDK、Token 或原始 provider DTO。

`dispatch_payload`/`receipt_payload` 不是宽松任意 JSON；它们必须先按 `ContractRef` 指向的 Aistaff owner Schema 严格验证，再交给已登记适配器。对当前 Desktop，这两个 payload 精确映射现有 `desktop_protocol.v1` request/receipt；未知或缺少签名/hash/lease/fencing 字段时在 dispatch 前拒绝。

### 2.4 协作、活动与物料

```ts
interface EngagementView {
  engagement_ref: string
  employee_ref: string
  title: string
  display_state: 'ready' | 'working' | 'waiting_user' | 'completed' | 'failed' | 'cancelled' | 'unknown'
  latest_activity_ref?: string
  revision: string
  created_at: string
  updated_at: string
}

interface ActivityView {
  activity_ref: string
  engagement_ref: string
  employee_ref: string
  display_state: 'queued' | 'working' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  material_refs: string[]
  interaction_refs: string[]
  revision: string
  created_at: string
  updated_at: string
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type EmployeeInputPart =
  | { kind: 'text'; text: string }
  | { kind: 'cloud_material_ref'; material_ref: string }
  | { kind: 'local_resource_handle'; handle_ref: string; display_name: string }

type CloudEmployeeInputPart =
  | { kind: 'text'; text: string }
  | { kind: 'cloud_material_ref'; material_ref: string }

interface SubmitEmployeeInput {
  operation_id: string
  engagement_ref: string
  parts: EmployeeInputPart[]
  expected_revision: string
}

interface CloudSubmitEmployeeInput {
  operation_id: string
  engagement_ref: string
  parts: CloudEmployeeInputPart[]
  expected_revision: string
}

type CloudSubmitEmployeeActivityWireInput = Omit<CloudSubmitEmployeeInput, 'engagement_ref'>

interface EngagementSnapshot {
  engagement: EngagementView
  activities: ActivityView[]
  materials: MaterialView[]
  interactions: InteractionRequestView[]
  receipts: EffectReceiptView[]
  next_cursor?: string
  owner_revision: string
}

interface CloudEngagementSnapshot extends EngagementSnapshot {
  snapshot_ref: string
  stream_ref: string
  resume_cursor: string
}

type MaterialBody =
  | { kind: 'text'; format: 'plain_text' | 'markdown'; text: string }
  | { kind: 'structured'; schema_ref: string; value: JsonValue }
  | { kind: 'artifact'; artifact_ref: string; media_type: string; byte_size: number; content_hash: string }
  | { kind: 'link'; url: string; label: string }

interface MaterialView {
  material_ref: string
  engagement_ref: string
  activity_ref: string
  title: string
  summary?: string
  body: MaterialBody
  presentation: 'inline' | 'preview' | 'download' | 'external'
  state: 'available' | 'blocked' | 'expired' | 'revoked' | 'unknown'
  allowed_actions: Record<string, { allowed: boolean; reason_code?: string }>
  revision: string
  created_at: string
}
```

`Engagement` 是用户与某个 AI 员工的持续协作容器，`Activity` 是一次用户输入触发的可见工作；一个 Activity 背后可有多个 Session/Run/Attempt，客户端不依赖这些 Runtime 细节。`MaterialView` 专门表达输出，统一承载 Aistaff 已有 `final_message`、`structured_output` 和 `Deliverable`；大文件只给 Artifact ref，预览/下载需另行签发短时 access grant。输入文件是另一类受用户授权和数据分类约束的 input material，不伪装成 Deliverable；`local_resource_handle` 只在 Host/Supervisor 边界有效，Cloud 只可获得经允许的上传物料 ref/hash/classification，不得获得路径或 OS handle。

Markdown 以禁用 raw HTML 的安全 renderer 显示，不自动加载远程图片、字体、iframe 或其他子资源；link 只允许产品 allowlist scheme，禁止 `javascript:`、`data:`、`file:` 与自定义执行协议，外部跳转需显示目标并由用户确认。Artifact 只经短时 access grant 和受控 preview/download handler 打开，服务端的 filename/media type 不能直接决定本机执行方式。

### 2.5 交互请求与必要本地操作

```ts
type InteractionRequestView =
  | InputRequestView
  | ApprovalRequestView
  | LocalOperationRequestView

interface InteractionBase {
  interaction_ref: string
  engagement_ref: string
  activity_ref: string
  title: string
  summary: string
  allowed_outcome_ids: string[]
  revision: string
  expires_at?: string
}

interface InputRequestView extends InteractionBase {
  kind: 'input'
  input_schema_ref: string
}

interface ApprovalRequestView extends InteractionBase {
  kind: 'approval'
  risk: 'low' | 'medium' | 'high' | 'critical'
  owner: 'cloud'
}

interface LocalOperationRequestView extends InteractionBase {
  kind: 'local_operation'
  capability_ref: string
  operation: string
  argument_schema_ref: string
  arguments: JsonValue
  risk: 'low' | 'medium' | 'high' | 'critical'
  effect_class: 'none' | 'reversible' | 'irreversible' | 'external_side_effect'
  resource_requirements: ResourceRequirement[]
  consent_required: boolean
}

interface ResourceRequirement {
  slot_ref: string
  resource_kind: 'file' | 'directory' | 'browser_context' | 'clipboard' | 'local_process' | 'mcp_server' | 'device_sensor'
  access: 'read' | 'write' | 'execute' | 'observe'
  scope_constraint_ref: string
  scope_constraint_hash: string
}

interface LocalResourceGrantAttestation {
  attestation_ref: string
  issuer_ref: string
  tenant_ref: string
  interaction_ref: string
  interaction_revision: string
  device_ref: string
  subject_ref: string
  identity_revision: string
  slot_ref: string
  capability_ref: string
  operation: string
  argument_hash: string
  proposal_hash: string
  resource_kind: ResourceRequirement['resource_kind']
  access: ResourceRequirement['access']
  scope_constraint_hash: string
  scope_hash: string
  grant_revision: string
  lifetime: 'one_shot' | 'engagement' | 'persistent'
  issued_at: string
  expires_at: string
  nonce: string
  signature: DeviceSignatureEnvelope
}

interface DeviceSignatureEnvelope {
  format: 'cose_sign1_detached'
  domain: 'aistaff.device-capability' | 'aistaff.local-resource-grant' | 'aistaff.client-execution-receipt'
  subject_ref: string
  key_ref: string
  algorithm: 'EdDSA'
  signed_payload_hash: string
  value_base64url: string
}

interface InteractionResponseInput {
  operation_id: string
  interaction_ref: string
  outcome_id: string
  values?: JsonValue
  local_consent_ref?: string
  expected_revision: string
}

interface CloudInteractionResponseInput {
  operation_id: string
  interaction_ref: string
  outcome_id: string
  values?: JsonValue
  local_grant_attestations?: LocalResourceGrantAttestation[]
  expected_revision: string
}

type CloudInteractionResponseWireInput = Omit<CloudInteractionResponseInput, 'interaction_ref'>
type MaterialAccessWireInput = Omit<MaterialAccessInput, 'material_ref'>

interface EffectReceiptView {
  receipt_ref: string
  subject_ref: string
  status: 'accepted' | 'succeeded' | 'failed' | 'rejected' | 'unknown'
  effect_state: 'none' | 'not_applied' | 'applied' | 'unknown'
  result_material_refs: string[]
  reason_code?: string
  revision: string
  recorded_at: string
}
```

Cloud Approval 是企业 Decision；Local consent/Grant 只允许当前设备尝试某个本机操作；Receipt 只证明执行器观察到的效果。三者只共享 subject/proposal/hash 关联链，不共享状态语义，也不得合并成一个 `approve`。完整顺序是 `Operation Intent → Cloud Decision/Approval → Local Consent/Grant → Dispatch → Receipt → Material/Reconciliation`。

Cloud 只能请求员工包声明且设备 Capability Snapshot 支持的 `capability_ref + operation + schema`；不得下发绝对路径、shell string、executable path、任意 argv/env 或 Secret。服务端是 operation、risk、effect class、policy、Decision 和 Approval 的 owner，客户端不得提交或覆盖 policy matrix、Tenant、risk/effect 或最终 execution target。风险与副作用分类独立：读取 PII 可以是 high risk 但 `effect_class: none`，一次低风险修改仍可能是 reversible effect。

本地目标由系统选择器与 Supervisor 转成 Opaque handle，真实 handle/path 只留在本地；Cloud 最多接收不含路径的签名 `LocalResourceGrantAttestation`。效果以 Receipt 为准；用户点击同意、服务端 HTTP 传输结束或文件下载完成，都不等于本地保存/打开/执行已成功。发生副作用后结果不确定时必须记录 `unknown` 并对账，禁止盲重试。

当前 Client 从 browser-safe `LocalCapabilityObjectLayer` 读取完整 snapshot replacement，Typert Remote 只传 opaque Grant、Consent、Receipt 和 operation status；path、token、socket、`FsTarget`、capability context、Cloud cursor 与本机读取内容不进入 Renderer。Mutation 遇到 carrier error 时保留原 `OperationId` 与原输入，先查询 operation，明确未接收时也只按同一 ID 重放。Supervisor Receipt 决定结算：只有 `succeeded` 可投影 active/revoked 或把有界结果交给 canonical Material owner；`failed/rejected/unknown` 只形成脱敏 Receipt 与一致状态。Material owner 接收成功结果后刷新完整 Employee Experience projection，Local snapshot 不复制正文。

Renderer 只能把 Host 签发的 opaque `local_consent_ref` 放入 `InteractionResponseInput`，不能构造 attestation。Host 用该 ref 向 Supervisor 读取一次已验证、未撤销的 attestation，再生成 Client Gateway 使用的 `CloudInteractionResponseInput`。Supervisor 按 contract artifact canonicalize attestation 的非 signature 字段，以设备私钥产生 detached COSE_Sign1，并精确绑定 issuer、Tenant、Subject、Device、identity/Interaction/grant revision、slot、capability/operation、argument/proposal hash、scope constraint/实际 scope、lifetime、expiry 与 nonce。Envelope 随同一次幂等 interaction response 内联发送；Cloud 在接受 consent 前验证设备登记 key、payload hash、nonce 和全部绑定，不能把本地 `signature_ref` 当成可解析证据。dispatch 前还要逐项重新核对，任何变化都重新 consent 或拒绝。

Grant 的 `DeviceSignatureEnvelope.domain` 固定为 `aistaff.local-resource-grant`，`subject_ref` 等于 `attestation_ref`；execution Receipt 使用 `aistaff.client-execution-receipt` 且 `subject_ref` 等于 execution ref。不同 domain 的合法签名不能互换重放。

### 2.6 与 Aistaff 现有代码的适配

| 稳定客户端资源 | Aistaff 当前 owner | 适配要求 |
| --- | --- | --- |
| `WorkforceSnapshot` / `EmployeeCard` | `EmployeeListItem`、Industry Pack、Tenant/Role 权限 | 服务端解析可见性与 active release，客户端不根据 lifecycle 猜测可运行性 |
| `EmployeeBundleManifest` | `ExecutionBundleManifest`、`ExecutableArtifactManifestV1`、Employee Release | 新增客户端 distribution manifest，只引用已编译/签名的 owner 产物 |
| `Engagement` | Runtime Session 或 canonical conversation/thread | 统一为用户协作投影，不暴露 release/binding/lease |
| `Activity` | `EmployeeInvocationRecord` 或 Runtime Run | 将多 attempt/recovery 折叠为一个用户活动 |
| `MaterialView` | `EmployeeInvocationResult.final_message/structured_output` 与 `DeliverableViewV1` | 转成安全语义 block，不将 trace/debug/provider payload 送入 Renderer |
| `InteractionRequestView` | Decision/Approval/Human Workbench | 只下发 owner 给出的 allowed outcomes 和展示字段 |
| `ClientExecutionAssignment` | `LocalExecutionRequestV1` + Artifact Admission | 保留原始签名/hash/lease/fencing 语义，不在产品层重新定义第二份 wire |
| `EffectReceiptView` | `LocalExecutionReceiptV1`、Deliverable access receipt 或 Cloud Decision receipt | 只向 Renderer 投影可显示摘要，原始签名/evidence 留在 owner |

当前服务端最短执行链已存在：Employee 列表 → 创建 Runtime Session → append user message → route Run → Scheduler/Worker 执行 → 查询 Run/Timeline。这些 API 保留为 Aistaff 内部 owner 合同，`EmployeeExperiencePort.submitInput` 必须由服务端 BFF 以一个幂等 operation 封装 message append + run route 与恢复查询；不得要求客户端管理 `last_event_sequence`、`trigger_event_sequence`、runtime target 或部分成功补偿。

当前 Aistaff 工作树还没有闭合“Run 完成 → 自动 Material”：Worker 可记录 output，但不会自动产生 deliverable candidate/materialize，Deliverable service 也只在部分 persistence composition 中装配。因此 Cloud 主干上线前必须在服务端关闭这条链：将 `final_message`、`structured_output` 投影为 inline Material，将文件/报告候选物以可重放的 Worker operation 写入 Deliverable owner，再发 Material changed event。客户端不得从 trace 或 raw worker output 自行造物料。

当前 AiDesktop 内存 `Employee/Task/Approval/Receipt` 合同只是纵向 UI 验收适配器，不是 Cloud 公共合同。接入真实 Aistaff 时将其替换为本节的 Workforce/Engagement/Activity/Material/Interaction 投影，不修改 DSH 页面 Slot 与基础交互语言。

上述 TypeScript 只冻结 Gateway 的产品语义和 owner 映射，不是可复制的生产 wire Schema。Aistaff 当前内部 `DeliverableViewV1` 含 Session/Run 等内部引用且标记 `production_ready: false`，Human Workbench/Decision DTO 也不是 Renderer 合同；AiDesktop 不得直接生成客户端类型、调用这些内部 endpoint 拼装投影，或用它们绕过下一节的发布 artifact。

### 2.7 Cloud Client Gateway wire

Aistaff 面向桌面的公共接口固定为一个 Client Gateway。它是对内部 Employee、Session、Run、Decision、Deliverable 和 Desktop Worker 服务的防腐层；内部服务可以独立重构，客户端不调用内部路由、不管理 Runtime event sequence，也不拼装跨服务补偿。初始 wire 使用固定 base `/api/client`。Bootstrap 请求以 `Aistaff-Client-Protocol-Offer: 2.0-2.3, 1.0-1.7` 提供 Gateway 范围；每项语法为 `<major>.<minimum_minor>-<same_major>.<maximum_minor>`，逗号分隔且按客户端偏好降序排列，最多 16 项/512 bytes，同一 major 不重复。服务端选择第一个被 rollout policy 允许的共同 major 及其最高共同 minor，在响应头与 `ClientBootstrap.contract` 同时返回例如 `Aistaff-Client-Protocol: 1.7`。

本节是目标公共 wire 的语义正文，机器可执行的唯一 owner 仍是 Aistaff 发布的不可变 artifact。Adapter 必须通过 artifact loader 和 `ClientGatewayTransport` 注入取得 parser、operation metadata 与载体；缺少发布 artifact/正式 transport 时 production 组合以 load-time 配置错误 `CLIENT_GATEWAY_UNAVAILABLE` 拒绝装载，该错误不进入 Renderer `ProductError`，也不能把本文代码块、test-only conformance artifact 或现有 `/api/v1` 内部路由当作生产 fallback。

Bootstrap 同时签发 opaque `contract_selection_ref`，精确绑定 installation、Gateway 版本、全部 selected contract/schema hash、Feature、identity tuple/revision 和到期时间。普通后续请求必须同时携带 `Aistaff-Client-Protocol: <selected>` 与 `Aistaff-Contract-Selection: <ref>`，响应 envelope/header 回显同一 ref；服务节点只能验证该选择，不能重新协商。选择过期或 identity revision 改变返回 `410 EXPIRED` 并要求重新 Bootstrap。唯二例外是 register-replay-only 使用注册前选择取回原结果，以及 recovery lane 使用原 claim 选择解析并核验已发生效果；两者都不能访问新业务资源或改变合同。Offer 格式错误返回 `400`，无共同 major 返回 `426`；两者都使用下列固定、版本无关的 media type 和 envelope，不能要求客户端先理解某个 Gateway major 才能升级：

```ts
interface BootstrapProtocolError {
  error: {
    code: 'PROTOCOL_OFFER_INVALID' | 'UPDATE_REQUIRED'
    message_key: string
    supported_protocols: SupportedContractRange[]
    minimum_client_version?: string
    upgrade_url?: string
  }
}
```

Bootstrap 错误 media type 固定为 `application/vnd.aistaff.client-bootstrap-error+json`；字段只允许向后添加可选值，客户端忽略未知字段。产品 DTO 不扩散 `V1` 后缀。

| 方向 | 服务端/客户端交付内容 |
| --- | --- |
| Cloud → Client | 协商结果、Workforce/Employee Assignment、签名 Device Bundle、Activity/Material/Interaction 投影、可选 Client Execution Assignment、升级/撤销/kill-switch |
| Client → Cloud | ClientHello、设备 capability/runtime adapter 声明、Bundle Activation Receipt、用户输入、Interaction response、本地 Grant attestation、执行/效果 Receipt |
| 双向恢复 | Opaque revision/cursor、Idempotency operation outcome、SSE replay 与 `unknown` reconciliation；不交换内部 Run/Worker 序号 |

#### 2.7.1 Operation matrix

除表中注明的 raw/SSE 响应外，成功 JSON 一律是 `application/json` 的 `CloudEnvelope<T>`，其中 `T` 是“成功 payload”；失败一律是 `CloudErrorEnvelope`。Path 中已有的 ref 不在 body 重复；若现有语义端口包含同名字段，adapter 必须先断言一致再从 wire body 去除。OpenAPI artifact 必须使用表内固定 `operationId`、request/response Schema 名和状态码，不得另起同义 DTO。

| `operationId` | Method / path | Security | Request | 成功 payload / status |
| --- | --- | --- | --- | --- |
| `clientBootstrap` | `POST /bootstrap` | `bootstrap_optional_host` | body `ClientHello` + offer header | `ClientBootstrap` / `200` |
| `registerDevice` | `POST /devices/registrations` | `host_session` | body `DeviceRegistrationInput` | `DeviceRegistrationView` / `201` |
| `createProjectionSnapshot` | `POST /projection-snapshots` | `host_session` | body `CreateProjectionSnapshotInput` | `ProjectionSnapshotLease` / `200` |
| `getWorkforceSnapshot` | `GET /workforce?snapshot_ref` | `host_session` | query `snapshot_ref` | `WorkforceSnapshot` / `200`；snapshot 读取不使用 `304` |
| `getEmployeeBundleManifest` | `GET /bundles/{bundle_ref}/manifest` | `host_session` | path only | `EmployeeBundleManifest` / `200` |
| `getBundleComponent` | `GET /bundle-components/{content_ref}` | `host_session` | path only | descriptor 指定 media type 的 raw bytes / `200` |
| `getBundleSignature` | `GET /signatures/{signature_ref}` | `host_session` | path only | `DistributionSignatureEnvelope` / `200` |
| `getBundleTrustChain` | `GET /trust-chains/{trust_chain_ref}` | `host_session` | path only | `DistributionTrustChainEnvelope` / `200` |
| `putDeviceCapabilities` | `PUT /devices/{device_ref}/capabilities` | `host_session` | body `DeviceCapabilityWireInput` | `EffectReceiptView` / `200` |
| `reportBundleActivation` | `POST /bundle-activations` | `host_session` | body `BundleActivationReceipt` | `EffectReceiptView` / `200` |
| `listEngagements` | `GET /engagements?snapshot_ref&cursor&limit` | `host_session` | query `snapshot_ref`、可选 cursor、bounded limit | `ProjectionPage<EngagementView>` / `200` |
| `openEngagement` | `POST /engagements` | `host_session` | body `OpenEngagementInput` | `EngagementView` / `201` |
| `getEngagementSnapshot` | `GET /engagements/{engagement_ref}?snapshot_ref&cursor&limit` | `host_session` | path、snapshot ref、可选 cursor/limit | `CloudEngagementSnapshot` / `200` |
| `submitEmployeeActivity` | `POST /engagements/{engagement_ref}/activities` | `host_session` | body `CloudSubmitEmployeeActivityWireInput` | `ActivityView` / `202` |
| `respondInteraction` | `POST /interactions/{interaction_ref}/responses` | `host_session` | body `CloudInteractionResponseWireInput` | `EffectReceiptView` / `200` |
| `createMaterialAccessGrant` | `POST /materials/{material_ref}/access-grants` | `host_session` | body `MaterialAccessWireInput` | `MaterialAccessGrant` / `201` |
| `getMaterialContent` | `GET /material-access-grants/{grant_ref}/content` | `host_session` | path only | grant 指定 media type 的 raw bytes / `200` |
| `getOperation` | `GET /operations/{operation_id}` | `host_session` | path only | `OperationStatusView` / `200` |
| `subscribeEmployeeEvents` | `GET /event-streams/{stream_ref}?after` | `host_session` | path + exclusive opaque cursor | `EmployeeEventEnvelope` SSE / `200` |
| `createDeviceExecutionCredential` | `POST /device-execution-credentials` | `host_session` | body `DeviceExecutionCredentialRequest` | `DeviceExecutionCredentialGrant` / `201`；V2/V3，Host-only secret response |
| `listClientExecutionOffers` | `GET /client-executions?cursor&wait_ms` | `device_execution` | bounded query | `Page<ClientExecutionOffer>` / `200`；V2/V3 |
| `claimClientExecution` | `POST /client-executions/{execution_ref}/claim` | `device_execution` | body `ClientExecutionClaimWireInput` | `ClientExecutionAssignment` / `200`；V2/V3 |
| `createDeviceRecoveryCredential` | `POST /client-executions/{execution_ref}/recovery-credentials` | `device_recovery_proof` | body `DeviceRecoveryCredentialRequest` | `DeviceRecoveryCredentialGrant` / `201`；V2/V3 |
| `submitClientExecutionReceipt` | `POST /client-executions/{execution_ref}/receipts` | `device_execution` 或 `device_recovery` | body `ClientExecutionReceiptWireInput` | `EffectReceiptView` / `200`；V2/V3 |
| `getClientExecution` | `GET /client-executions/{execution_ref}` | `device_execution` 或 exact-execution `device_recovery` | path only | `ClientExecutionStatusView` / `200`；V2/V3 |

`getBundleComponent` 与 `getMaterialContent` 必须返回准确 `Content-Type`、`Content-Length`、`Content-Digest`，禁止 redirect、content sniffing 和动态压缩；客户端仍以签名 descriptor/grant 中的 size/hash 为事实源。Material HTTP 传输完成只表示 Cloud transfer 完成，不表示本机已保存、打开或执行。路径是 Client Gateway 的初始 transport 面；TypeScript 端口才是 Renderer/Host 的稳定依赖。服务端可以拆分内部服务或把 endpoint 落到不同进程，但同一 Gateway origin、认证、错误和幂等语义不得随内部部署变化。

#### 2.7.2 Envelope、认证与并发

```ts
interface CloudEnvelope<T> {
  contract: ContractRef
  contract_selection_ref: string
  request_ref: string
  server_time: string
  data: T
}

type CloudErrorCode =
  | 'INVALID_REQUEST' | 'UNAUTHENTICATED' | 'FORBIDDEN'
  | 'NOT_FOUND' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_CONFLICT'
  | 'EXPIRED' | 'CURSOR_EXPIRED' | 'POLICY_DENIED'
  | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UPDATE_REQUIRED'
  | 'UNKNOWN_OUTCOME'

interface CloudErrorEnvelope {
  contract: ContractRef
  contract_selection_ref: string
  request_ref: string
  error: {
    code: CloudErrorCode
    message_key: string
    retryable: boolean
    current_revision?: string
    retry_after_ms?: number
    operation_id?: string
    supported_protocols?: SupportedContractRange[]
  }
}
```

`CloudEnvelope.contract`/`CloudErrorEnvelope.contract` 必须等于所选 Gateway envelope contract；payload Schema 由 operation matrix 的 `operationId` 和 artifact OpenAPI 唯一确定，服务端不能按请求字段动态选择。所有非 Bootstrap 响应同时回显 `Aistaff-Client-Protocol` 与 `Aistaff-Contract-Selection` header；header、envelope 和本地当前选择任一不一致都停止处理并重新 Bootstrap。

| HTTP / Cloud code | Host `ProductError.code` | 客户端动作 |
| --- | --- | --- |
| `400 INVALID_REQUEST` | `INVALID_REQUEST` | 修正本地请求；不原样展示服务端正文 |
| `401 UNAUTHENTICATED` | `UNAUTHENTICATED` | 重新登录/Bootstrap，不盲重试写入 |
| `403 FORBIDDEN` / `POLICY_DENIED` | `FORBIDDEN` / `DENIED` | 展示安全 reason，不重试绕过策略 |
| `404 NOT_FOUND` | `NOT_FOUND` | 资源不可见或不存在，不探测跨租户存在性 |
| `409 IDEMPOTENCY_CONFLICT` | `CONFLICT` | 停止该 key；查询已有 outcome |
| `409 UNKNOWN_OUTCOME` | `UNKNOWN_OUTCOME` | 查询原 operation 或人工对账，禁止新 key 重做 |
| `410 EXPIRED` / `CURSOR_EXPIRED` | `EXPIRED` | 操作过期停止；cursor 过期执行 identity-wide snapshot reset |
| `412 REVISION_CONFLICT` | `CONFLICT` | 重读 owner revision，再由用户确认新操作 |
| `426 UPDATE_REQUIRED` | `VERSION_MISMATCH` | 停止不兼容能力并进入升级入口 |
| `429 RATE_LIMITED` / `503 UNAVAILABLE` | `UNAVAILABLE` | 仅按 `Retry-After`/backoff 重试可安全操作 |

Cloud `message_key` 由 Host 映射为本地安全文案。Adapter 不把下游正文、trace 或内部 error type 透传 Renderer。

- `bootstrap_optional_host` 允许无凭据调用并只返回 `signed_out`/兼容信息；登录态使用 OAuth 2.1 Authorization Code + PKCE 和 RFC 9449 DPoP。`host_session` 固定发送 `Authorization: DPoP <access_token>` 与 `DPoP: <proof-jwt>`，token audience 为 Client Gateway；Host 持有 token，Renderer 永远不可见。Bootstrap 的 ready identity 给出服务端验证的 `issuer_ref + tenant_ref + subject_ref + device_ref + identity_revision`，Cursor、Bundle、Grant 和 execution 授权均绑定此完整元组；业务 body 中的同名值只能做一致性断言，不能改变范围。
- 设备注册只接受 Bootstrap nonce、所选 attestation contract 和三把用途隔离的公钥；`registration_nonce` 必须等于 attestation nonce，私钥均在 OS Secure Store/Supervisor。注册命令的专用幂等命名空间是 `issuer_ref + tenant_ref + subject_ref + installation_ref + operation_id`。成功后旧 contract selection 进入至少 10 分钟的 register-replay-only 状态：只允许相同 key/fingerprint 重放原 `201 DeviceRegistrationView`，其他资源全部拒绝；客户端也可用同一 installation 与已登记 DPoP key proof 重新 Bootstrap，恢复同一 device ref。取得绑定 ready device identity 的新选择后才调用其他资源。
- `DeviceExecutionCredentialGrant` 是 DPoP 公钥绑定、最长 15 分钟、audience/scope 固定的 Host-only secret；Host 只经具名本地端口把它交给 Supervisor，不写日志、Store 或 Renderer。`device_execution` 使用该 token 与设备 DPoP proof；过期、注销、identity revision 变化或设备撤销立即停止新 offer、新 claim 和任何尚未发生的 effect。
- `device_recovery_proof` 只用于 `createDeviceRecoveryCredential`：Supervisor 发送注册设备 DPoP proof、原 claim 时的 contract selection ref 和 `DeviceRecoveryCredentialRequest`，不使用通用 bearer。服务端必须保留 outstanding execution 所需的原 receipt Schema/selection 到审计期限，验证 exact execution/effect/dispatch/receipt hash、`aistaff.client-execution-receipt` 签名与 fencing 后，签发最长 5 分钟、DPoP-bound 的 `DeviceRecoveryCredentialGrant`。`device_recovery` 仅指该 token；receipt/status endpoint 不接受另一种直接恢复协议。
- 已 claim 且 terminal Receipt 已先落本地 journal 的 execution 不因 identity revision 变化而丢失结果。Recovery token 只能提交其绑定的一个签名 terminal Receipt 或读取该 execution 的 receipt ack，不能读取正文/其他 execution、领取工作、延长 lease 或启动/重试 effect。服务端以原 effect key 幂等记账；身份已撤销时可以拒绝额外详情，但仍不得把同一 effect 重新执行。
- 每个命令同时发送 `Idempotency-Key: <operation_id>`，body 中的 `operation_id` 必须相同。除上述注册专用规则外，稳定幂等命名空间是 `issuer_ref + tenant_ref + subject_ref + device_ref + operation_id`，不包含可变的 `identity_revision`；fingerprint 为 HTTP method、规范 path、selected request Schema hash 与 canonical body 的组合。JSON parser 先拒绝重复 key 和非 Schema 字段，再对原始语义值执行 RFC 8785 JCS；不注入 Schema default，字段缺省与显式 `null` 不等价。首次记录的 action/path/body hash 此后不可改变，跨 action 重用同一 key 返回 `IDEMPOTENCY_CONFLICT`。`identity_revision` 是接受新命令时由认证上下文提供的授权快照，不由调用方 body 选择。
- 对任何 key，服务端都先在稳定命名空间查找既有 outcome 或 tombstone，再判断当前身份是否可以读取结果；已存在但当前无权读取时可以返回 `FORBIDDEN`，却仍视为已消费且绝不能重新执行。仅在 key 从未出现时，才按当前 ready identity revision 验证并接受新命令。只有 HTTP method、规范 path、selected request Schema hash 与 canonical body 都相同，即完整 fingerprint 一致时才返回首次 owner 结果；即使 body 相同，只要 Schema hash 或其他 fingerprint 分量不同也返回 `IDEMPOTENCY_CONFLICT`，绝不重新执行。客户端通过 `/operations/{operation_id}` 读取已有 outcome，并按其中的 `result_contract` 解析原合同结果。
- 新 key 先完成协议/选择、认证授权、严格 Schema、policy 和 revision precondition；这些检查失败不消费 key。所有检查通过后，Gateway 必须在进入 owner mutation 的同一事务中 reserve action/fingerprint；从该点开始，成功、业务拒绝和 terminal error 都保存为 operation outcome，进程失败则保留 `pending/unknown`，不得释放 key。完整 fingerprint 相同且原结果与当前响应合同兼容时，重放保留原 HTTP status 与 typed data/error，但 `contract`、`contract_selection_ref`、两个协议 header、`request_ref/server_time` 必须按当前有效选择重建，并返回 `Idempotency-Replayed: true`；原结果不兼容当前响应合同时返回 `409 IDEMPOTENCY_CONFLICT`，引导客户端读取 `/operations/{operation_id}` 中带 `result_contract` 的原 outcome，绝不重新执行。
- 服务端对普通命令至少保留 30 天完整幂等结果，此后仍保留足以拒绝 key 重用的 tombstone；Approval、本机副作用、Bundle Activation、claim 和 Receipt 按审计/对账期限保留。过期 key只能返回 `EXPIRED`/`UNKNOWN_OUTCOME`，不得当作新命令执行。客户端超时后只用原 key、原 body 重试或查询 `/operations/{operation_id}`，绝不生成新 key 猜测重做。
- 新 key 的 `409/412` precondition failure 在命令进入 owner 前返回，不表示操作已接受。客户端重读后若用户意图仍有效，使用新 revision、重新确认后的 body 和新 `operation_id`；只有 transport outcome unknown 才以原 key/原 body 重试或查询。
- Device capability `generation` 对同一设备单调递增；旧 generation 即使重放也不能覆盖新 snapshot。Effect claim/receipt 的 `effect_key` 在 execution 生命周期内稳定，服务端以 execution+effect key+dispatch hash 防止重复副作用。
- Revision 的 JSON 值是服务端生成的 base64url opaque token；HTTP 使用强 ETag，格式固定为 `ETag: "<revision>"` 与 `If-Match: "<expected_revision>"`，禁止 weak tag、`*` 或 tag list，body/header 值必须一致。只有更新既有 revisioned subject 的命令需要二者。`Retry-After` 是 transport 权威值；若同时有 `retry_after_ms` 且不一致，客户端采用更长等待并记录脱敏协议告警。Raw content 的 `Content-Digest` 使用 RFC 9530 `sha-256`，必须与 DTO 的 SHA-256 base64url 值表示同一 digest。
- `202 Accepted` 必须返回已创建的 `ActivityView`/`OperationStatusView`，不能只返回空成功；`409/412` 带当前 opaque revision；`410 CURSOR_EXPIRED` 丢弃整个 projection staging/checkpoint，并用新的 `ProjectionSnapshotLease` 做 identity-wide 重建；`426 UPDATE_REQUIRED` 停止不兼容能力；`429/503` 带 `Retry-After`。
- `EmployeeExperiencePort` 里的 `local_resource_handle` 只存在 Renderer→Host。调用 Cloud 前，Host 必须经用户同意把它转换成允许上传的 `cloud_material_ref`，或返回 `DENIED`；Client Gateway 永不接受本机 handle、绝对路径或 OS 对象。

#### 2.7.3 事件、分页与恢复

初始同步或任何 reset 先创建 `ProjectionSnapshotLease`，再让所有 Workforce/Engagement/Page GET 携带同一个 `snapshot_ref`。该 lease 针对 Client Gateway 自己的用户投影/event log 一致性切点，不要求跨内部业务数据库维持长事务。每个响应必须回显相同 `snapshot_ref/stream_ref/resume_cursor`，同一分页链的 `owner_revision` 也保持不变。Snapshot 过期或无法继续时返回 `CURSOR_EXPIRED`，客户端丢弃本次 staging 并整组重开，不能混用两个 snapshot 的页面。

客户端把整组基线写入 staging，完整读取成功后在一个本地事务中替换当前 Cloud Projection 并提交该 `stream_ref/resume_cursor`，再以 exclusive `after=<resume_cursor>` 建立 SSE；snapshot 创建与建立连接之间发生的事件必须由服务端 retention 重放。若 query cursor 与 `Last-Event-ID` 同时存在但不同，服务端拒绝请求。

SSE 响应固定 `Content-Type: text/event-stream; charset=utf-8`、`Cache-Control: no-store, no-transform`，禁用压缩/代理 buffering。每个业务 frame 精确为 `id: <cursor>`、`event: employee.projection`、单行 `data: <EmployeeEventEnvelope JSON>` 加空行；`id` 必须等于 envelope cursor，`payload_type` 必须等于 payload 内的 `type`。Heartbeat 只能是无 `id/data` 的 comment frame `: heartbeat <RFC3339>`，不能推进 checkpoint。服务端在发送 `200` 前验证 cursor；retention gap 返回 JSON `410 CURSOR_EXPIRED`，流建立后发现 identity/reset 则发送非忽略 `projection.reset` 后关闭。

客户端必须按服务端时间校正后的 `contract_selection_expires_at`，最迟在到期前 30 秒停止接收并重新 Bootstrap；服务端不得在到期后发送业务 frame，并应在到期前发送 `projection.reset(reason_code=contract_selection_expired)` 后关闭，无法发送时直接关闭。客户端对本地判定已过期选择的任何 frame 都不应用、不推进 cursor。新选择必须创建新的 `ProjectionSnapshotLease` 并执行 identity-wide projection rebuild，不能把旧 cursor 带入新合同。

SSE wire 只发送 forward-open `EmployeeEventEnvelope`，envelope 的 `contract_selection_ref/stream_ref` 必须与请求 header、路径和本地 checkpoint 完全一致。`envelope_contract` 必须是已选择的 Gateway event-envelope major；`payload_contract` 可引用更高 minor。客户端先按已知 envelope 解析 `event_ref/cursor/payload_type/ignorable`，只有认识的 payload contract/type 才转换为类型化 `EmployeeClientEvent` 交给 Host object layer。未知 payload 在 `ignorable: true` 时不解析并推进 cursor，非忽略时停止且不推进；因此更高 payload minor 不会先被通用“未知版本”规则错误拒绝。Response envelope/payload 允许已协商的 forward-open 可选字段，request parser 仍按 selected minor closed。

服务端对同一 ready identity 元组保证 cursor 顺序并采用至少一次投递；客户端按 `event_ref` 去重，并在同一事务中应用完整资源替换和保存新 cursor。资源 `revision` 只做 equality/CAS，不能用字符串大小判断新旧；服务端不得在 `resume_cursor` 之后投递代表更早资源状态的替换事件。

未知事件只有 `ignorable: true` 时才能记录 cursor 后忽略；未知非忽略事件不得前移 cursor，Host 返回 `VERSION_MISMATCH` 并提示升级。`projection.reset` 必须是非忽略的 identity-scope 事件；它、游标过期或 identity 元组变化都清除当前 identity 的全部可重建 Cloud Projection，并按 snapshot lease 算法整组恢复。新 checkpoint 只能来自新 snapshot。SSE heartbeat 不是业务事件，也不能推进 Projection revision。

分页 cursor、event cursor、owner revision、ETag 和所有资源 ID 都是 opaque；客户端只做相等比较。列表顺序由服务端定义并在 cursor 生命周期内稳定，新增/删除导致失效时明确返回 `CURSOR_EXPIRED`，不能静默跳项。

#### 2.7.4 独立升级规则

1. Gateway protocol 先按 offer header 选择；`ClientHello.supported_contracts` 再按唯一 `(name, major)` range 选择每个子合同。存在多个共同 major 时，按 offer 顺序选择首个被服务端 rollout policy 允许的共同 major，再选该 major 的最高共同 minor；响应头、`ClientBootstrap.contract` 和 `selected_contracts` 必须一致。服务端不得给设备分配它没有声明的必选 Feature、capability 或 Runtime adapter。
2. 同一 major 内，服务端可新增可选 response 字段和 `ignorable` 事件；客户端忽略它们。新客户端按选中的 minor 发送旧服务端认识的 request，不依赖服务端忽略未知写字段。
3. 新 enum 值只有在已有 `unknown` 降级语义或 Feature 协商后才能加入 minor；新增必选字段、必处理事件、交互类型、权限含义或副作用含义必须升 major。
4. 发布顺序固定为：服务端先接受新旧合同并发布兼容投影 → 客户端逐步声明新能力 → 服务端只向已声明设备启用新能力 → 经过兼容窗口后再停止旧 major。服务端内部 Schema/Run/Worker 迁移不得改变已选择的 Client Gateway 合同。
5. 正常升级至少同时支持当前与上一 major，并提前 180 天在 Bootstrap 返回 `update_by`；安全事件可立即 `blocked`，但必须给稳定 reason code 和无数据损坏的恢复/升级入口。
6. Aistaff 仓以独立 JSON Schema 文件为 wire source of truth；OpenAPI 3.1 只 `$ref` 这些文件，生成类型不是第二 owner。每个不可变 contract artifact 至少包含 `artifact-manifest.json`（artifact SemVer、Gateway ranges、逐文件 media type/SHA-256、root hash）、`openapi/client-gateway.json`、`schemas/**`、`events/**`、`crypto/**`、`conformance/{provider,consumer}/**` 和兼容性报告。AiDesktop 只 pin 已发布 artifact 的精确版本、registry integrity 与 root hash，不从 Aistaff 工作区路径导入或手抄生产 parser。服务端 CI 做 backward-compatibility/provider conformance，客户端 CI 使用同一 artifact 做 parser、consumer fixture 和 replay；双方发布不互相等待仓库 commit。

#### 2.7.5 服务端首个可联调闭环

服务端首批只需关闭 `client_mode: none` 的纵向主干：`bootstrap/必要设备注册 → projection snapshot → workforce/展示 Bundle 激活 → open engagement → submit activity → activity event → inline/file material/content → interaction response → receipt → reconnect replay`。`capability_only` 和 `managed_runtime` endpoint 可以在 Bootstrap 中保持 disabled，不能用空成功或 Fixture 冒充支持。

在该 provider 前置条件尚未满足时，AiDesktop 只可用带固定 root hash、`test_only` provenance 和隔离 transport 的 conformance artifact 验收 consumer；该组合不得读取生产凭据、写 production `ProductStore`、注册 production profile 或生成真实 Cloud evidence。正式 artifact/endpoint 到位后必须用同一 adapter 通过黑盒 provider conformance，不能把 conformance fixture 改名为 production。

服务端交付联调环境时同时提供：协议 artifact、Gateway major/contract selection/版本无关 426、注册响应丢失重放、固定测试 identity 的 Workforce/Employee Bundle、错误 Subject/Device/signature/root digest、signed capability snapshot、纯文本与文件 Material/content、Input/Approval Interaction、幂等重放/冲突/过期 tombstone、同一 snapshot lease 的分页基线+resume cursor、selection/snapshot/cursor 过期和稳定错误 fixture。客户端以这些黑盒行为验收，不依赖服务端数据库、内部 Runtime ID 或调用顺序。

### 2.8 Renderer↔Host 载体

工程 Web/首个本机包可由既有 HTTP/WebSocket adapter 承载稳定产品端口，但只绑定 `127.0.0.1:0`、只加载 stdout 精确 readiness origin，并校验 Host/Origin、请求 Schema 与大小；该载体不处理真实客户数据。

客户包改用 Electron IPC：Preload 暴露具名函数和只读订阅，不暴露通用 channel、raw `ipcRenderer`、路径、Node object 或任意 URL fetch。Main 对每次调用校验 sender frame、allowlisted URL、固定方法、request id、Schema 与大小；事件流使用 bounded `MessagePort` 或等价适配器，reload/close 必须取消 port 与 in-flight 请求。Tenant/identity 切换先发 `projection.reset`，再发新 Workforce/Engagement 基线。

## 3. Host↔Supervisor

Host 与 Supervisor 有两个独立逻辑平面，不能混用版本或字段。

### 3.1 AiDesktop 控制平面

`aidesktop.supervisor-control.v1` 由 AiDesktop 拥有，承载本地 Grant、bounded read、Receipt 与 operation reconciliation。握手返回 Supervisor version、支持的 control versions、平台、能力表和请求/result 上限；不兼容时 Host 停止能力入口。

```ts
interface SupervisorControlPort {
  hello(): Promise<SupervisorHello>
  registerGrant(input: SupervisorGrantRegister): Promise<SupervisorGrantResult>
  revokeGrant(input: SupervisorGrantRevoke): Promise<SupervisorReceipt>
  readCapability(input: ReadCapabilityRequest): Promise<ReadCapabilityResult>
  getReceipt(input: { receipt_ref: string }): Promise<SupervisorReceipt>
  readOperation(input: { operation_id: string }): Promise<SupervisorOperationStatus>
}
interface SupervisorHello {
  control_version: 'aidesktop.supervisor-control.v1'
  supervisor_version: string
  supported_control_versions: string[]
  platform: string
  architecture: string
  capabilities: string[]
  max_request_bytes: number
  max_result_bytes: number
  capability_context_handle: string
}
type SupervisorSubjectBinding =
  | { kind: 'local'; activity_ref: string; dsh_session_id: string }
  | {
      kind: 'managed'
      tenant_id: string
      device_session_id: string
      run_id: string
      step_id: string
      attempt: number
      dsh_session_id: string
    }
interface SupervisorGrantRegister {
  operation_id: string
  subject: SupervisorSubjectBinding
  root_path: string
  display_name: string
  access: 'read_only'
  allowed_intents: string[]
  expires_at: string
}
interface SupervisorGrant {
  grant_handle: string
  grant_revision: string
  display_name: string
  access: 'read_only'
  allowed_intents: string[]
  expires_at: string
  root_fingerprint: string
}
interface SupervisorGrantResult { grant: SupervisorGrant; receipt: SupervisorReceipt }
interface SupervisorGrantRevoke {
  operation_id: string
  grant_handle: string
  expected_grant_revision: string
}
interface ReadCapabilityRequest {
  operation_id: string
  execution_context:
    | { kind: 'capability_only'; capability_context_handle: string }
    | { kind: 'managed_runtime'; runtime_handle: string }
  subject: SupervisorSubjectBinding
  grant_handle: string
  expected_grant_revision: string
  intent: string
  relative_segments: string[]
  max_bytes: number
  deadline_at: string
}
type ReadCapabilityPayload =
  | { kind: 'file'; bytes: Uint8Array; media_type: string }
  | { kind: 'directory'; entries: Array<{ name: string; kind: 'file' | 'directory'; size_bytes?: number }> }
  | { kind: 'metadata'; target_kind: 'file' | 'directory'; size_bytes?: number }
interface ReadCapabilityResult {
  payload: ReadCapabilityPayload
  receipt: SupervisorReceipt
}
interface SupervisorReceipt {
  receipt_ref: string
  operation_id: string
  status: 'succeeded' | 'failed' | 'rejected' | 'unknown'
  effect_state: 'none' | 'not_applied' | 'applied' | 'unknown'
  reason_code?: string
  evidence_refs: string[]
  receipt_hash: string
  recorded_at: string
}
interface SupervisorOperationStatus {
  operation_id: string
  state: 'succeeded' | 'failed' | 'rejected' | 'unknown'
  receipt_ref?: string
  updated_at: string
}
```

`capability_only` 不启动本机员工 Runtime，必须使用 Supervisor hello 为当前 Host 会话签发的 opaque `capability_context_handle`；该 handle 不能保存到 Renderer、Cloud 或跨 Supervisor 重启复用。

Managed `SupervisorSubjectBinding` 只能由已验证的 Cloud/Device Session 上下文派生，Renderer 提交的同名 ID 不可信。`root_path` 只在此 privileged hop 出现；返回值不回路径。

Supervisor 在每次 `readCapability` 调用时重新解析目标；`max_bytes` 必须小于握手与 Locked policy 的较小值。结果只返回 bounded bytes/metadata、无绝对路径的 evidence 与 Receipt。Provider 把真正进入模型的内容写成 DSH Session Event 后才能提交下一次模型请求。

控制平面稳定拒绝码至少区分：`SUPERVISOR_UNAVAILABLE`、`RUNTIME_VERSION_MISMATCH`、`GRANT_NOT_ACTIVE`、`GRANT_REVISION_MISMATCH`、`GRANT_SCOPE_MISMATCH`、`CAPABILITY_DENIED`、`TARGET_IDENTITY_CHANGED`、`DEADLINE_EXPIRED`、`OUTCOME_UNKNOWN`。已可能发生副作用后不得返回“未执行”。

控制认证材料只能通过受限 inherited descriptor/pipe、OS keychain handle 或可验证 peer credential 交付，不进入 argv、普通 env、URL、日志或 crash report。

仓内 Rust Supervisor、`SupervisorProcessService` 与 `supervisor-control-process` 已形成真实 Host control 链：每次启动生成认证 token，经 inherited stdin pipe 一次性交付后才接受带同一 token 的 bounded JSONL；命令经过 allowlist，stderr 不进入产品错误。显式注入 data key 的 control runtime 已能持久执行 bounded file read 与 directory list，并用原 operation ID 重放 Receipt/result；发布 sidecar 默认不注入 key、不声明 control capabilities，桌面 production profile 也不装载该 Provider。旧 file service 继续返回 `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`，正式 artifact、设备 attestation 与 Cloud Receipt ack/reconciliation 到位前不得启用 `capability_only`。

### 3.2 Aistaff Managed relay 平面

`desktop_transport.v1` 只用于 Host/Electron Main 与 Rust Supervisor 的短时本地 channel bootstrap。它只交换 Aistaff 已有 `channel_bootstrap`/`channel_accepted`，采用 1 MiB raw frame 上限，并验证 sender/origin、OS peer、binding proof、one-time claim 与 device-session mapping。

Channel 建立后，每个 Managed execution frame 仍是原始 `desktop_protocol.v1` bytes，必须重新做大小、strict Schema、hash、signature、session、sequence 和 admission 校验。Bootstrap 成功不授予 Cloud Capability，也不允许 product control DTO 伪装成 Cloud frame。

## 4. Host↔DSH：`DshRuntimePort`

Host 适配 adoption ledger 所指 DSH 源码快照已有的 `ApiProxy`，不新增 AiDesktop 版 Session API。初始桌面能力只依赖：

| DSH 方法/流 | 用途 |
| --- | --- |
| `host.describe` | 进程版本和就绪检查 |
| `session.list` | 重连与本地 Session 基线 |
| `session.create` | 使用 Host 预分配的 `sessionId`、Locked `agentPreset` 和应用 execution cwd 幂等创建 |
| `session.history` | 分页读取原始 Session Events 与 projection baseline |
| `session.prompt` | 提交文本/附件引用；模型可见输入由 DSH 持久化 |
| `session.cancel` | 请求停止当前 Turn，不声称副作用已回滚 |
| `events.mux` | `session/event`、Approval/Question、queue、projection 等流 |
| `events.host` | Session 生命周期、运行状态和 host error |
| `respond` | 回答带 DSH `rpcId` 的 Approval/Question server request |

Electron Loopback 包由 Main 以 `process.execPath`、`ELECTRON_RUN_AS_NODE=1` 和 `process.resourcesPath/runtime` 中的入口启动该 Host，传入 Locked `web` profile、端口 `0` 及[数据文档](./数据.md#31-electron-状态根)分配的 `VOYASEEK_HOME`/cwd。启动超时、ready 行格式错误、非 loopback URL 或 child 提前退出统一关闭窗口入口并报告 `UNAVAILABLE`；应用退出必须等待 child tree 结束。

DSH `RpcResult<T>` 的业务错误不抛异常；Host 保留 code 并映射安全 message。连接丢失后重开 streams，再读取 `session.list` 与目标 `session.history`；`events.mux.since` 当前不是可依赖的恢复协议。

产品创建 Session 时 Renderer 不提交 cwd、Profile 或 agent preset。Host 先分配 operation/product/session identity，再以相同 `sessionId + cwd` 重试 `session.create`；不同 cwd 的 `session-conflict` 进入人工恢复，不能另建一个无映射 Session。

产品不得调用 DSH `host.pickDirectory`/`listDirectory` 把绝对路径带入 Renderer；目录授权走 ProductHost→Supervisor。产品也不读 DSH SQLite 私有表，Session/Event 只经该端口访问。

DSH Client 与 Host 当前共同发布，因而 DSH API 不另造 wire version；兼容性由 DSH adoption snapshot ref、Host version 和产品 smoke 冻结。若上游方法变化，升级适配器与全部调用方一起更新，不保留猜测字段的兼容层。

## 5. Supervisor↔Cloud：Aistaff Desktop Edge

这是逻辑执行边界；物理 Cloud channel/claim adapter 必须由 Aistaff 提供并通过设备身份验证。AiDesktop 不定义 `TaskEnvelope`，只 pin Aistaff 从 `packages/contracts` 发布的不可变精确版本 contract artifact：

- `desktop-protocol.v1.schema.json` 与对应 TypeScript/Rust types；
- `DesktopProtocolEnvelopeV1`；
- `LocalExecutionRequestV1` / `LocalExecutionReceiptV1`；
- Desktop device/session/capability/update policy types。

每个 `desktop_protocol.v1` envelope 绑定 tenant、device、device session、sequence、issued/expiry、payload hash、signature 和 payload。Execution request 中的 Run/Step/Attempt、Artifact admission、Decision、Capability scope、policy、effect/idempotency、lease/fencing/revision、command/input refs 与 request hash 全部由 Cloud 权威合同解释；AiDesktop 不删减成另一套 DTO。

Supervisor 必须在原子 claim 成功后才执行，terminal Receipt 先进入本地 journal 再发送。Receipt 保留 Aistaff 现有 status/effect-state/reason-code/hash-chain/signature 语义；`unknown` 先对账，禁止盲重试。Cloud 接收 Receipt 后才更新其 canonical Run/Audit；本地 journal 不是 Cloud Audit。

`desktop_transport.v1` 不属于 Supervisor↔Cloud wire，也不能替代 `desktop_protocol.v1`。[Client Gateway](#27-cloud-client-gateway-wire) 已冻结逻辑 claim/receipt/reconciliation 路径；生产 Cloud channel、设备身份、lease/fencing 与 retention 的实现证据仍需 Aistaff owner 在 V3 前交付，缺失时只允许协议 conformance/Staging，不声明生产执行。

## 6. 版本与兼容策略

| 边界 | 版本 owner | 策略 |
| --- | --- | --- |
| Renderer↔Host | AiDesktop `aidesktop.product-host.v1` | App 内共同发布；握手不匹配即停止所有 product calls |
| Product Host↔Cloud Client Gateway | Aistaff Client Gateway contract artifact | Bootstrap 协商共同 major/minor 与 Feature；正常同时支持当前/上一 major，内部服务部署不改变已选合同 |
| Electron shell↔packaged Runtime | `electron@42.7.0` + Runtime manifest | 共同签名/替换；启动前校验目标 OS/arch、manifest 与原生模块，不允许 PATH fallback |
| Host↔Supervisor 控制 | AiDesktop `aidesktop.supervisor-control.v1` | `hello` 协商精确支持集；未知 major 拒绝，不猜测降级 |
| Host↔Supervisor Managed relay | Aistaff `desktop_transport.v1` + `desktop_protocol.v1` | Bootstrap 与 execution frame 分别校验；任一版本不匹配即关闭 channel |
| Host↔DSH | adoption ledger 所指 DSH snapshot 的 `ApiProxy` | 共同升级，无本地复制版本；产品兼容矩阵记录 snapshot ref/API smoke |
| Supervisor↔Cloud | Aistaff `desktop_protocol.v1` | 由 Cloud minimum agent policy 和 Schema conformance 管理；不支持即升级/回滚 |

任何版本拒绝都返回当前版本、所需版本和升级/回滚入口的安全摘要，不返回 raw payload、路径、proof 或 Secret。
