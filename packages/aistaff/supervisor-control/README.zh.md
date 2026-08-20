# Aistaff Supervisor 控制模块

[English](README.md) | 中文

本包拥有仅限宿主（Host）使用的 `aidesktop.supervisor-control.v1` 服务定义（Service Definition）。`SupervisorControlPort` 注册为 `ctx.aistaffSupervisorControl`，承载 Supervisor 握手、本地资源授权（Grant）的注册与撤销、受限能力读取、回执（Receipts）以及幂等操作协调。

`SupervisorGrantRegister.root_path` 是唯一公开的路径字段，且仅在特权宿主至 Supervisor 的调用中存在。所有返回的授权（Grant）、有效载荷（payload）、回执（Receipt）、错误及操作状态均不携带路径信息，并采用不透明的、带品牌标识的身份凭证。当前宿主会话通过 `hello()` 方法获取一个全新的 `capability_context_handle`；`capability_only` 类型请求必须使用该句柄，不得自行构造本地运行时（Runtime）身份。

本包仅为一项服务定义（Service Definition），而非文件系统实现或传输层实现。生产环境下的提供方（Service Provider）必须完成对等端身份认证、自主维护授权账本（Grant ledger）与回执日志（Receipt journal）、在每次读取前即时重新校验资源身份与配额限制，并在故障传播至该端口前拦截所有涉及路径的异常。

云审批（Cloud Approval）、本地用户授权（local consent）、Supervisor 授权（Supervisor Grant）以及 DSH 工具审批（DSH tool Approval）均为彼此独立的决策环节。

## 表面接口（Surface）

```text
const hello = await ctx.aistaffSupervisorControl.hello()
const result = await ctx.aistaffSupervisorControl.readCapability({
  operation_id,
  execution_context: {
    kind: 'capability_only',
    capability_context_handle: hello.capability_context_handle,
  },
  subject,
  grant_handle,
  expected_grant_revision,
  intent: 'file/read_text',
  relative_segments: ['notes.txt'],
  max_bytes: 65536,
  deadline_at,
})
```

若调用结果不确定，则失败并抛出 `SupervisorControlError` 错误，其错误码为 `OUTCOME_UNKNOWN`，并携带原始 `operation_id` 及保留的 `receipt_ref`。调用方须通过 `readOperation()` 或 `getReceipt()` 进行操作协调，**不得**创建新的操作身份（operation identity）。

## 模型体验

无，因为该特权 Host 控制服务不贡献 DSH 提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；任何返回内容是否在之后进入模型请求由消费方负责。

## 已知限制与待办事项

- **尚无生产环境提供方**：包内自带的内存型提供方仅用于确定性约定测试（deterministic contract tests），不执行任何文件系统 I/O 或伴随文件（sidecar）I/O。
- **暂无持久化回执日志**：跨进程重启的操作恢复能力，属于生产环境 Supervisor 提供方的职责范畴。
- **缺乏设备可信证明（device attestation）**：签名机制与云端分发（Cloud dispatch）属于 V2 阶段工作，将在本地控制通路验证完备后启动。
