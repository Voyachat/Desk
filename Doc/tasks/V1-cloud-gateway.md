# V1 Cloud Client Gateway

## 交付物

一个把版本化 contract artifact 与 Cloud transport 作为必选注入的 Cloud adapter，以及独立的 `EmployeeExperiencePort` object layer，在现有 DSH Client 插件中打通 `Workforce → Activity → Material → Interaction → Receipt → reconnect replay`。Aistaff 尚未发布 Client Gateway artifact/endpoint 时，本块只以明确的 test-only conformance artifact/transport 完成同一主干；production Cloud bundle 必须保持 fail-loud，服务端内部 Session、Run、Worker、Decision 和 Deliverable DTO 不进入 Client。

## read_first

- `AGENTS.md`
- `Doc/tasks/README.md`
- `Doc/API.md` 第 2 节，尤其 2.7 Client Gateway wire
- `Doc/架构.md` 第 1—5 节
- `Doc/数据.md` 第 1、2、4、5 节
- Aistaff 发布的精确 contract artifact、hash 与 conformance fixtures；尚未发布时只读服务端 owner 事实与本任务的 test-only conformance fixture，不把设计稿或内部 DTO 当作发布 artifact

## read_if

- 修改 Remote carrier 时只读 `packages/aistaff/product-remote/**` 和邻近 DSH Remote 实现。
- 修改页面投影时只读 `packages/aistaff/client-product/**`；不得为了 Cloud DTO 改写 DSH chrome。
- 真实 OIDC 接线时才读 Electron Main/Preload 和 Secure Store owner。

## do_not_load

- Aistaff 全仓或其数据库/Worker 实现
- Aistaff-Client 全仓
- `desktop_protocol.v1`、Supervisor 和文件能力实现
- DSH Agent Loop 与全部历史文档

## owned files

- `packages/aistaff/employee-experience/**`（正式 Renderer-safe DTO、`EmployeeExperiencePort` Service Definition 与 object-layer observable）
- `packages/aistaff/cloud-client/**`（Cloud wire adapter、validator、SSE/recovery）
- `packages/aistaff/cloud-product-bundle/**`（生产组合；不得装载 Fixture projection/remote）
- `packages/aistaff/client-product/**` 中把组件改接 `EmployeeExperiencePort` hooks，并把业务 projection 移出 Slot Store
- 本任务新增的聚焦测试/fixtures

共享 Remote aggregate/profile 只在上述包单独通过后做最小集成；Electron、Supervisor、Aistaff 服务端和公共 contract artifact 不由本块修改。`product-contracts/product-projection/product-remote/product-bundle` 四个 Fixture 包冻结不动，生产不得用同名 service 覆盖、导入其 DTO 或静默回退它们；conformance artifact/transport 只能从测试组合显式注入。

## 最小范围

- 先实现必选的 artifact loader/validator 与 `ClientGatewayTransport` 注入点；Aistaff 发布不可变 artifact 后 pin 精确版本、registry integrity 与 root hash，不得从 `/Users/baron/projects/Aistaff` 路径导入。
- 实现 Bootstrap 协商和 `client_mode: none`；不声明本机 capability 或 Runtime adapter 已可用。
- 实现 Workforce、Engagement、Submit Activity、Material access、Interaction response、Operation outcome 和 SSE cursor replay。
- `EmployeeExperiencePort.observe()` 原子返回初始 Renderer-safe snapshot 并注册 replacement listener；Cloud cursor/SSE envelope 只在 Host。Client object layer 持有业务 projection，Slot Store 只保留 open/selection/draft/busy/error。
- Cloud mutation 使用同一 `operation_id`/`Idempotency-Key` 与 opaque revision；超时查询 outcome，不生成新 operation。
- 保留现有内存 Provider 仅供组件测试；production Cloud bundle 必须同时注入已 pin 的发布 artifact、正式 transport 与身份配置，任一缺失或 hash 不匹配都在注册 provider 前失败，不能静默回退 Fixture。
- 服务端未发布 artifact 时只允许用明确标注 `test_only`、固定 root hash 的 conformance artifact/transport 完成 adapter 骨架与浏览器 smoke；不得手写第二份生产 Schema、调用现有内部 Aistaff API 拼装 Gateway，或宣称真实联调完成。

## 验收

- Consumer tests 覆盖 Gateway major/contract selection/版本无关 426、设备注册丢响应重放、signed capability snapshot、Bundle identity/transport/payload digest/signature 拒绝、跨 identity revision 的稳定幂等重放/冲突/过期 tombstone、revision 冲突、`202` Activity、inline/file Material content、Interaction Receipt、同一 snapshot lease 的全基线/`resume_cursor`、SSE 重复/selection 到期、cursor 过期整组重建和未知非忽略事件。
- Package test 证明 production Cloud bundle 不含 Fixture projection/remote，缺少发布 artifact/正式 transport 时以稳定错误拒绝装载，Store 不含 Workforce/Engagement/Activity/Material/Interaction projection，reload 的初始 snapshot 与随后 replacement 无竞态。
- Conformance 浏览器 smoke 保持 DSH 默认页面不变，并完成选择员工、提交输入、看到 Material、回答 Interaction、刷新恢复；它必须显示 test-only provenance，不能以 production profile 命名或生成 production evidence。
- 服务端环境可用后，用相同测试 Tenant 和 artifact 运行黑盒 conformance；测试不得读取服务端数据库或内部 Runtime ID。

## 停止条件

上述 conformance 用户流程可观察且可恢复、production 缺少正式输入时 fail-loud 即停止；真实 artifact/endpoint 可用后再补同一 adapter 的黑盒联调证据。不实现本地文件、Supervisor、受管 Runtime、员工管理后台、通用工作流引擎或服务端内部 API adapter。

## 下一块

先完成真实账号和 Electron IPC/加密交付；随后另拆 `capability_only` 本地只读能力，`managed_runtime` 再后置。
