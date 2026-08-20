# Aistaff Supervisor 控制流程提供方

[English](README.md) | 中文

本包仅可在宿主（Host）环境中运行，基于经过身份验证的 `SupervisorProcessService` 实现 `SupervisorControlPort` 接口。该提供方在发布 `ctx.aistaffSupervisorControl` 前执行 `control.hello` 调用；要求依赖 `aidesktop.supervisor-control.v1` 协议版本；校验服务所声明的能力限制，并严格验证其是否精确支持 `file/read_text` 与 `directory/list` 两种能力；若 Rust 进程不兼容，则拒绝加载该插件。

授权注册（Grant registration）、授权撤销（Grant revocation）、受限读取（bounded reads）、凭据查询（Receipt lookup）以及操作对账（operation reconciliation）分别直接映射至 `control.grant.register`、`control.grant.revoke`、`control.capability.read`、`control.receipt.get` 和 `control.operation.read` 等底层控制方法。该提供方对每个请求与响应均执行完整校验；将 Rust 返回的 `bytes_base64` 编码字节流解码为 `Uint8Array`；保留所有带品牌标识（branded）的值为其原始 JSON 字符串形式；且绝不在 TypeScript 层创建新的 Receipt 或替换操作标识符（operation identity）。

仅 `SupervisorGrantRegister.root_path` 字段会跨越特权边界，触发从宿主（Host）到 Supervisor（监管进程）的调用。所有返回的控制元数据及预定义错误均不包含路径、URL、认证令牌、进程端点或子进程诊断信息；所请求的文件字节内容始终仅为用户选定的内容本身。超时的操作返回 `OUTCOME_UNKNOWN` 状态、并附带原始 `operation_id`；调用方须基于该原始标识符进行对账，而非在新标识符下重试。`managed_runtime` 被明确拒绝，因为本提供方仅实现当前宿主（Host）会话下的 `capability_only` 执行上下文。

## 模型交互体验

### Supervisor 进程适配器

#### 模型可见内容

模型无法直接感知本提供方。消费者（Consumer）必须先将 `SupervisorControlPort` 返回的内容记录至所属 DSH 会话（DSH Session）中，后续模型请求才可能包含这些内容。

#### Token 影响

无影响。本提供方不向提示词（prompt）注入任何内容，不提供工具 schema，也不生成任何会话事件（Session event）。

#### KV Cache 影响

无影响。控制类调用不会修改模型请求。

## 已知限制与待办事项

- **外部云平台准入机制仍属必需** —— 本提供方仅能证明并执行本地 Supervisor（监管进程）的决策；它不提供云平台审批（Cloud Approval）、设备可信证明（device attestation）、产物准入（artifact admission）、凭据确认（Receipt acknowledgement）或云端对账（Cloud reconciliation）等能力；因此，单靠本提供方尚不足以启用生产级桌面配置文件（production desktop profile）。
