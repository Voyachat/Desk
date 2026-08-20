# Agent Note：复杂任务目标的独立验证

状态：已实现

[English](2026-08-19-independent-complex-goal-verification.md) | 中文

## 问题

现有 goal driver 续行同一 session 模型，Ralph 会启动 fresh worker，但接受 worker 自己声明完成。两条路径都不会在认证复杂任务前独立检查真实环境。长程任务还需要持久地区分 Executor 声明与 Auditor 验证状态，同时不能新增另一套 agent loop 或文件账本。

## 决策

`@voyaseek-ai/dsh-complex-goal` 增加面向用户的 `/goal-complex` 命令与按语义选择的 `complex_goal` 模型工具，并复用现有 goal、session、shell、subagent、sandbox-policy、approval、system-prompt、tool 与 command 服务。模型入口接受任何语言，但要求运行中的根 Agent 本轮具有宿主证明的直接用户输入。每轮启动一个无工具的 fresh Manager、一个 fresh Executor 和一个 fresh Auditor。共享 in-process subagent driver 新增窄的 provider-owned setup 与 cwd 选项，让两个活动角色进入任务 workspace，并在 Auditor 发布前应用 `sandbox/mode: read-only`；现有委派逻辑把审批固定为 `never`。

所属 session 日志仍是唯一持久权威。每个 version-3 `complex-goal/change` 事件携带转换后的完整状态，包括冻结的任务 workspace、`verificationGates`、总耗时截止点与恢复尝试。Executor 报告只作为未经验证的声明保留。Auditor 启动前，宿主通过 `ctx.shell` 在强制文件系统只读 sandbox policy 下运行每个已配置的原始命令，并持久化有界输出与执行事实。不支持 sandbox 的执行器会在命令运行前被拒绝；缺少只读 enforcement、sandbox 拒绝、超时、runner 失败或非零退出都会使检查失败。只有 `status: complete`、`integrity: clean` 和 `alignment: aligned` 的 Auditor 结果，并且所有已配置检查均通过，才能完成底层 goal；检查失败时，Auditor 的完成声明不能覆盖可信状态。只有被接受的 Auditor requirement、artifact、fact 与证据状态可以跨轮传递。持久状态若停在结果未知的 execution，恢复时会先验证和审计，再允许任何 Executor 副作用。

本设计采用 MIT 许可 LongHorizon-Harness 基线 commit `be2e7b42523c4f35291f1ed57b683f6c03a29cdc` 的 Manager–Executor–Auditor 职责分离与证据门。精确上游路径、本地实现路径、差异和升级策略记录在[开源采用台账](../../../../.open-source/adoptions.yaml)。项目不嵌入上游 Python 源码或运行时依赖。

## 结果

可独立观察的假完成会在 goal 进入 complete 前被拒绝，包括与确定性证据冲突但满足 schema 的 Auditor 假阳性。重启会保留最后一份已验证状态、验证计划、任务 workspace、恢复尝试与总截止点。自动调和与条件式 Git 隔离由[持久调和决策](2026-08-20-durable-complex-goal-reconciliation.md)负责。正常每轮需要三次 fresh 模型请求和已配置验证命令。文件系统 sandbox 不能阻止可信的已配置命令修改远程服务，因此部署策略只允许观察性命令并限制其凭据。token 或价格准入与远程副作用 exactly-once 仍然延期。

## 备选方案

没有依赖或 Fork LongHorizon-Harness，因为它的 Python CLI、文件账本、Dashboard 与 Agent 生命周期会重复产品权威。没有扩展 `agent-loop`，因为现有插件扩展点已经负责调度与持久化。也没有扩展 Ralph，因为它的前台 workflow 没有持久的已验证状态 owner，而改变其完成语义会破坏它刻意保持较小的职责。
