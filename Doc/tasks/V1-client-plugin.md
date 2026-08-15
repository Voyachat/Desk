# V1 正式 Client 产品插件（UI 切片已完成）

## 交付物

一个正式 DSH Client 插件，在 `sidebar.footer.action` 增加“AI 员工”入口，并在 `shell.overlay` 呈现员工工作台；默认 DSH 聊天、工作区和设置布局不被替换。当前 Task/Approval 数据只是组件验收 Fixture，正式 Cloud 语义由下一任务适配。

## read_first

- `AGENTS.md`
- `packages/client/AGENTS.md`
- `Doc/tasks/README.md`
- `Doc/API.md` 第 2 节，尤其 2.6 的 Fixture 定位
- `packages/client/ui-sidebar/src/client/contract/slots.ts`
- `packages/client/ui-layout/src/client/index.ts`
- `packages/client/ui-slots/src/store.ts`

## read_if

- 注册方式参考 `packages/client/ui-workflow-run/src/client/index.ts`。
- 组件样式只按需读取 `docs/web-styling.md` 和已有邻近组件。
- 需要测试运行时才读 `packages/test-support/client-runtime` 的对应 fixture。

## do_not_load

- `apps/frontend-demo` 的整包代码；只可按需查看已验证文案和状态名称。
- DSH Host、Agent Loop 与云执行实现。
- 全部设计文档和历史记录。

## owned files

- `packages/aistaff/client-product/**`

共享 DTO、根 tsconfig、Bundle patch、依赖清单和最终装配由主 Agent 负责。

## 最小范围

- Footer 入口支持宽栏与折叠栏。
- Overlay 工作台具备关闭、员工选择、任务标题输入、创建任务、任务状态列表。
- 待审批任务显示摘要和风险，支持批准或拒绝并展示回执。
- 数据访问封装为可替换 `AistaffClientPort`；首轮可用内存实现，组件不得硬编码订阅或访问 Cordis Context。
- 状态边界按 Slot store / injected plain callbacks / props-only component 划分，便于迁入正式 Client 插件。

## 验收

- 组件测试覆盖打开/关闭、创建任务、批准、拒绝和回执可见行为。
- Slot 注册测试证明只占用 additive slots，插件卸载后注册消失。
- 包级 typecheck、测试和 client bundle 通过。

## 停止条件

真实 DSH 页面中的主流程可操作即停止；不实现员工管理后台、权限矩阵、云连接或完整设置页。

## 下一块

进入 `V1-cloud-gateway.md`，新增独立正式 `EmployeeExperiencePort` object layer 与 production bundle；冻结本地 Fixture Port/Store/Remote，Slot、组件 props 和 DSH 默认交互保持不变。
