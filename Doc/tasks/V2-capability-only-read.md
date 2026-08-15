# V2 capability_only：受限本机只读

## 状态

Conformance 主干和 production read/list 的本地前置层已完成，production 启用仍受外部交付阻塞。当前代码具备独立维护的 Rust Supervisor、认证有界的真实进程 transport、持久本地 Receipt/operation Store、Host-only `SupervisorControlPort` production adapter、`LocalCapabilityPort`/Typert Remote、DSH 工作台中的 Local Consent UI，以及 test-only Cloud local conformance 组合。

真实 Rust control 平面已经能在显式测试构造中执行 bounded read/list，并以加密 SQLite 在进程重启后重放同一 operation 的 Receipt/result；发布 sidecar 默认不注入 data key、不声明 control capabilities，旧 production file service 仍固定返回 `LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED`。当前桌面 profile 也不装载 Cloud local conformance 或 production Local Capability，因此不能声称 `capability_only` 已可处理真实客户数据。

## 已交付

- Rust Supervisor 源码由 AiDesktop 独立维护，不依赖 Aistaff-Client 工作区；进程 transport 经 inherited stdin pipe 一次性交付每次启动 token，再使用命令 allowlist、bounded JSONL 和有界停止。
- Rust control 平面使用 `rusqlite` 的 bundled SQLite 记录 Grant、operation、Receipt 与 replay result；application id/schema、`BEGIN IMMEDIATE`、WAL、权限、symlink、错 key、密文篡改和未知版本均失败关闭，路径与 bounded result 以 AES-256-GCM 字段加密。
- `SupervisorControlPort` 只在 Host 暴露 handshake、Grant、bounded read、Receipt 与 operation reconciliation；`root_path` 只存在于 Grant 注册的 privileged hop。
- `supervisor-control-process` 严格映射六个 `control.*` 命令，校验完整请求/响应与预算，载体超时保留原 operation ID；它不生成 Receipt、身份或 conformance fallback。
- `LocalCapabilityPort` 从当前权威 `local_operation` 派生 subject、slot、revision、intent、arguments 与 expiry，Renderer 只见 opaque resource/consent/receipt 引用。
- Client 只从 browser-safe `local-capability/object-layer` 取得完整 replacement；Typert Remote 不携带 path、token、socket、`FsTarget`、Cloud cursor 或读取内容。
- Cloud Approval、Local Consent、Supervisor Grant 与 DSH Tool Approval 保持四套独立状态；任一缺失都不能由其他状态替代。
- mutation 发生 carrier error 时保留原 `OperationId` 和原输入，先读取 operation 状态；明确未接收时也只以同一 ID 重放。
- Supervisor Receipt 是结算事实：只有 `succeeded` 可创建 active resource、发布 canonical Material 或投影 revoked；`failed/rejected/unknown` 保留脱敏 Receipt 并产生一致的 operation state。
- test-only Cloud local conformance 通过真实 Host↔Renderer Remote 和正式 UI 完成目录选择、Local Consent、Material、Receipt 与 projection refresh；它使用 in-memory Supervisor，不启动 Rust sidecar。

## 不可破坏边界

- DSH 默认页面、Agent Loop、Workspace UI、FS/Sandbox 与 Approval 实现不修改；产品能力只通过插件、Service、Remote 和 Slot 叠加。
- 系统选择器只把路径交给 Host/Supervisor；Cloud `local_operation` 不得直接调用 DSH FS，Renderer 不得获得路径、token、socket、`FsTarget` 或 capability context。
- Conformance 的固定 root hash、`test_only` provenance 与 in-memory Supervisor 只证明 consumer 链路，不能作为 Rust production read、设备身份或 Cloud dispatch 的证据。
- 未确定结果只用原 operation ID 对账，不生成新 ID 猜测重做；canonical Material owner 接受结果并刷新完整 projection 后，UI 才展示产出。

## 验收结论

- Conformance：已完成。包级测试覆盖选择取消、revision/scope、Grant expiry/revoke、failed/rejected/unknown Receipt、幂等 replay、路径与 token 不进入 Renderer，以及 Cloud canonical Material/Receipt refresh。
- Production：blocked。本地 control/provider/persistent replay 已完成，但发布 sidecar 尚未接 OS Secure Store data key，桌面 profile 未装配该 Provider；正式 artifact、设备身份/attestation 与 Cloud Receipt ack/reconciliation 仍未交付。

## 下一块

只处理 production read 启用：取得并 pin 正式 contract artifact，接入设备身份与 attestation，从 OS Secure Store 派生 Supervisor Store data key，装配现有 process Provider 与 Cloud ack/reconciliation sink，再把 production bundle 加入桌面 profile。文件写入、Process、Browser、MCP 与 `managed_runtime` 不进入该块。
