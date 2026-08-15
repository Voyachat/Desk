# V1 Host↔Client Remote 主干

状态：已完成。真实 DSH Web 组合的 keyless 主流程、Host/Client 类型检查和产品聚焦测试均已通过。

## 交付物

真实 DSH Web 组合中的 AI 员工纵向切片：Host 投影通过 Typert Remote 提供给 Client Port，产品 Bundle 以插件方式叠加，用户可在保留原 DSH 页面时创建任务、处理审批、查看回执并关闭工作台。

## read_first

- [`AGENTS.md`](../../AGENTS.md)
- [实施任务索引](./README.md)
- [V1 Fixture 合同与投影](./V1-contracts.md)
- [V1 Client 产品插件](./V1-client-plugin.md)
- [DSH Profiles and bundles](../../docs/architecture.md#profiles-and-bundles)
- [Renderer↔Host 载体](../API.md#28-rendererhost-载体)
- [`product-contracts` README](../../packages/aistaff/product-contracts/README.md)、[`product-projection` README](../../packages/aistaff/product-projection/README.md) 与 [`client-product` README](../../packages/aistaff/client-product/README.md)

## read_if

- 新增或生成 Remote 时，只读 [`product-remote`](../../packages/aistaff/product-remote/README.md)、`packages/feedback/message-feedback` 的相邻 Remote 模板和 `packages/api/remotes` 装配入口。
- 修改组合时，只读 [`product-bundle`](../../packages/aistaff/product-bundle/README.md) 与目标 Web E2E scaffold。
- Cloud adapter 进入实现时转到 [V1 Cloud Client Gateway](./V1-cloud-gateway.md)，不在本块扩写 Cloud wire。

## do_not_load

- Aistaff 与 Aistaff-Client 全仓
- Electron、Supervisor、SQLite、Cloud 同步与真实执行实现
- `packages/core/agent-loop`、DSH 历史文档与生成目录

## owned files

- `packages/aistaff/product-contracts/**`
- `packages/aistaff/product-projection/**`
- `packages/aistaff/product-remote/**`
- `packages/aistaff/client-product/**`
- `packages/aistaff/product-bundle/**`
- `apps/web/tests/aistaff-product.e2e.ts`
- 上述包在现有 Host/Client aggregate、`packages/api/remotes` 和根 workspace manifest 中所需的最小装配项

## 最小范围

- Host 只暴露 `getSnapshot`、`createTask` 和 `respondApproval`；Client mutation 后重新读取快照，不伪造远程事件。
- Typert codec 校验远程输入与输出；载体失败和产品失败保持不同错误语义。
- 产品 Bundle 显式配置至少一个本地 Fixture 员工；空目录在加载时失败。
- `approve` 只产生 `approved`，用户文案为“已批准，等待执行”；没有执行 Provider 时不得产生 `succeeded` 或“已完成”。
- 本块不增加持久化、Cloud DTO、工作流引擎、文件副作用或本地 Runtime。

## 验收

- 包级类型检查、聚焦测试、Host bundle 和 Client bundle 通过，Typert 生成产物纳入现有 aggregate。
- keyless Web E2E 启动真实产品 Bundle，验证原 DSH 页面保留、打开工作台、创建任务、批准、看到“已批准”任务与回执、关闭工作台。
- 测试和构建不依赖模型 Key、外部服务或本机仓外代码。

## 停止条件/下一块

真实 Host↔Client 主流程在 Web 组合中通过即停止；下一块进入 [V1 Cloud Client Gateway](./V1-cloud-gateway.md)，以正式 Cloud adapter 替换 Fixture 数据源，不改写已验收的 DSH Slot 与页面结构。
