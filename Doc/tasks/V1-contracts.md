# V1 UI Fixture 合同与 Host 投影（已完成）

## 交付物

一组只用于验证 UI 与状态边界的最小 JSON DTO，以及本地 Host 投影服务：员工目录、任务、待审批项和回执可以创建、读取、订阅并由确定性事件重建。本块不是 Aistaff Cloud 公共合同。

## read_first

- `AGENTS.md`
- `Doc/tasks/README.md`
- `Doc/API.md` 中 2.6 的 Fixture 定位；Cloud 公共语义由第 2 节其余内容持有
- `Doc/数据.md` 中 V1 表和 owner 说明
- `packages/core/session/src/types.ts`（只理解 durable event 约束，不改）

## read_if

- 新增 Cordis Service 时读 `packages/workspace/workspace` 或同类最小 Service 包。
- 需要持久化时才读现有 `packages/storage/**`；首轮允许内存 Provider，但接口必须可替换。

## do_not_load

- `Aistaff-Client` 全仓
- `Aistaff` 非 desktop-agent 合同目录
- DSH 全部历史文档和生成目录

## owned files

- `packages/aistaff/product-contracts/**`
- `packages/aistaff/product-projection/**`

共享根配置、Bundle 和 Client 文件由主 Agent 负责。

## 最小范围

- 员工：`id/name/role/status/capabilities`，仅作为确定性 Fixture。
- 任务：`id/employeeId/title/status/createdAt/updatedAt`。
- 审批：`id/taskId/summary/risk/decision`，只允许 `approve` 或 `reject`。
- 回执：任务结果、时间和可显示摘要。
- 内存事件源与确定性 projection；持久 SQLite、云同步、真实执行不在本块。
- `AistaffClientPort` 是当前组件适配 seam；接入 Cloud 时由 `EmployeeExperiencePort` adapter 替换，不向服务端发布这些 Task DTO。

## 验收

- 聚焦测试证明：创建任务会生成可查询任务；审批决定只能发生一次；事件重放得到相同快照；未知员工或审批产生明确失败。
- 包级 typecheck、测试和 build 通过。

## 停止条件

合同和投影足够 Client 首流程使用即停止；不要建设通用工作流引擎、同步协议或权限平台。

## 下一块

进入 `V1-cloud-gateway.md`；本包停止扩展，后续只保留组件回归 Fixture，避免形成第二套 Cloud 状态机。
