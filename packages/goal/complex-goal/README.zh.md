# @voyaseek-ai/dsh-complex-goal

[English](README.md) | 中文

为复杂目标提供独立环境验证、持久自动恢复与可选的逐任务 Git worktree。根 Agent 可以从任何语言的直接用户请求语义中选择 `complex_goal`；`/goal-complex <objective>` 仍作为显式 Web 命令保留。插件复用 `ctx.goals` 管理目标生命周期、复用所属 session 日志持久化状态、复用 `ctx.agents` 冷恢复，并通过 fresh in-process subagent 分别运行 Manager、Executor 与 Auditor。设计采用[开源采用台账](../../../.open-source/adoptions.yaml)记录的 MIT 许可 LongHorizon-Harness 基线中的 Manager–Executor–Auditor 职责划分，也采用[持久调和 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-20-durable-complex-goal-reconciliation.md)记录的 Apache-2.0 Symphony 基线中的外层调和方式；不嵌入上游运行时、文件账本、Dashboard 或源代码。

## 行为

Manager 只接收不可变目标与最新 Auditor 可信状态，不获得环境工具；它选择一个有界合同或要求直接审计。Executor 在 fresh session 中接收合同，并按父 session 现有权限策略修改工作区；其结构化报告只是未经验证的声明。

Auditor 启动前，宿主会通过 `ctx.shell` 在显式文件系统 `read-only` sandbox policy 下运行 `verificationGates` 中的每条命令。不支持 sandbox 的执行器会在命令运行前被拒绝。命令、有界输出、退出状态与 sandbox 事实会被持久化；非零退出、超时、sandbox 拒绝、runner 失败或缺少只读 sandbox 回报都会使检查失败。模型不能提供或修改这些命令；只有全部已配置检查通过，任务才可能完成。

Auditor 在另一个 fresh session 中启动。provider-owned 创建 hook 会在发布前追加 `sandbox/mode: read-only`，共享委派路径把审批固定为 `never`；固定白名单还把 Auditor 限制在父级实际存在的观察工具。只有 `status: complete`、`integrity: clean` 与 `alignment: aligned` 同时成立，并且确定性检查已通过，才提交完成。Auditor 在检查失败时声称完成，不能替换可信状态。每次被接受的审计都会完整替换后续 Manager 可以读取的可信 requirement、artifact、fact 与证据状态。

每次转换都向父 session 追加完整的 version-3 `complex-goal/change` 快照，并在下一次可能产生副作用的 Executor 启动前完成持久化刷新。快照会冻结任务工作区、`verificationGates`、有界证据大小、开始时间、总耗时截止点与恢复尝试。session persistence 中的 planning、executing、auditing 或 paused 状态会被自动发现并恢复；executing 或 auditing 必须先重新验证与审计，之后才能启动另一个 Executor。连续自动失败会使用持久指数退避，达到配置上限后转为可见的 blocked goal。`/goal-complex resume` 仍是人工恢复入口，但不再是必需开关。

## 任务工作区与回写

`workspaceIsolation: auto` 只在 session 有 cwd、源目录是干净 Git worktree 且 `ctx.subprocess` 可用时创建 detached Git worktree。非 Git 或脏源目录会继续使用共享 session 目录，并持久记录降级原因；`required` 则在创建 goal 前失败。Manager 没有环境工具；私有 Executor 与 Auditor provider 都使用冻结的任务 cwd，验证命令也在该目录的只读 sandbox 中运行。

隔离目标执行期间不会修改源 checkout。确定性检查与独立审计接受完整目标后，宿主针对冻结的源 commit 构建一份有界 binary diff，先用 `git apply --check` 验证，再应用到源 checkout。源 HEAD 移动或 patch 冲突会阻止完成并保留 worktree。应用后崩溃也保持幂等：再次完成前会用 reverse-apply 校验识别同一 patch 已经存在。插件始终保留 worktree 供检查，不会自动删除。

## 模型自动入口

`complex_goal` 作为普通模型工具注册，并带有 system prompt 选择规则。选择依据任务语义而不是关键词：中文、英文或其他语言的真正复杂、存在依赖且需多阶段完成的直接用户目标，无需手动切换模式即可触发。执行时权限仍要求当前调用者是运行中的顶层 Agent，并且本轮包含宿主证明的直接用户输入；subagent 与非用户注入轮次不能启动它。

## 命令

```text
/goal-complex <objective>
/goal-complex
/goal-complex resume
```

空参数命令显示当前持久状态。一个 session 同时只能有一个未完成的普通或复杂目标。

## 配置

`verificationGates` 默认为空列表，因为不存在适合所有员工工作区的通用测试命令。部署或项目 overlay 可以固定其仓库认可的权威命令：

```yaml
- id: complex-goal
  name: '@voyaseek-ai/dsh-complex-goal'
  config:
    automaticResume: true
    schedulerPollIntervalMs: 5000
    retryInitialDelayMs: 2000
    retryMaxDelayMs: 60000
    maxRecoveryAttempts: 5
    maxAutomaticResumes: 2
    workspaceIsolation: auto
    workspaceRoot: /absolute/durable/complex-goal-workspaces
    workspaceCommandTimeoutMs: 30000
    promotionPatchMaxBytes: 8388608
    maxDurationMs: 3600000
    verificationTimeoutMs: 120000
    verificationOutputMaxBytes: 8192
    verificationGates:
      - id: typecheck
        command: pnpm run typecheck
      - id: tests
        command: pnpm run test
        timeoutMs: 300000
```

命令顺序稳定，每条已配置命令每轮运行一次。重启后，活跃目标继续使用已持久化的任务工作区、验证计划、截止点与重试状态；配置变更只影响之后的新目标。包级默认关闭工作区隔离，便于最小组合；随产品提供的 base bundle 则使用 harness home 下的持久目录启用 `auto`。

## 扩展点

本包消费现有 agent、goal、session、shell、subagent、tool、sandbox-policy、approval、system-prompt 与 command 服务。session persistence 会激活薄的 poll/reconcile/retry 任务平面；只有启用工作区隔离时，subprocess 才用于可信的参数向量 Git 操作。两个私有角色 provider 复用共享 in-process driver 选择任务 cwd，其中 Auditor 额外应用只读覆盖。它不把进程内 Jobs 当作持久权威，不暴露第二套 workflow engine，也不修改 `agent-loop`。

## 模型体验

### 语义任务选择

#### 模型看到什么

根 Agent 会看到生成的 [`complex_goal` schema](../../../docs/tool-catalog.md#voyaseek-aidsh-complex-goal)，以及 `tool:complex-goal` system prompt 规则；该规则根据任何语言的语义选择真正复杂、存在依赖、需要多阶段完成且直接来自人类的目标。

#### Token 影响

根请求携带一个稳定的工具定义和一个简短的 prompt section。objective 参数只增加从当前直接用户请求推导出的文本。

#### KV Cache 影响

在插件版本或配置变更前，工具定义与选择规则跨轮保持稳定。objective 属于调用数据，不改变可复用的请求前缀。

### Fresh 角色请求

#### 模型看到什么

Manager 看到不可变目标、轮次上限、最新 Auditor 可信状态、上一次审计和上一次验证结果；Executor 看到一个有界合同与可信状态；Auditor 看到目标、合同、可信状态、被明确标记为未经验证的 Executor 声明，以及权威的确定性命令证据，并必须检查环境后返回结构化结论。

#### Token 影响

每轮增加一次 fresh Manager 请求、通常一次 fresh Executor 请求和一次 fresh Auditor 请求。只审计的恢复过程省略 Executor 请求。只有最新的有界审计状态跨轮传递。

#### KV Cache 影响

每个角色运行在独立 fresh session 中。provider 可以复用稳定 persona 与 schema 前缀；目标、合同和审计状态会随 run 与轮次变化。

## 已知限制与延期工作

- **每个持久目录只允许一个协调器**——poll/reconcile 会在单进程内去重，Agent registry 仍是 live 冲突权威；它不是分布式 lease 协议，两个 harness 进程不能协调同一个可写 session store。
- **隔离是条件式的**——`auto` 会记录 `not-git`、`dirty` 或 provider 不可用等降级原因并使用共享工作区。隔离回写要求源 HEAD 保持在冻结 commit；它会保留 staged 与无关文件，但在任务路径冲突时阻止完成。
- **文件系统恢复不等于外部 exactly-once**——结果未知的 Executor 会先被审计，worktree 回写也具备幂等性；但修改远程系统的工具仍需自身幂等键与证据。文件系统 sandbox 不能回滚或证明远程副作用。
- **保留 worktree**——成功或阻塞的任务 worktree 都不会自动删除；生命周期清理与磁盘配额属于后续工作区管理界面。
- **验证由项目配置**——安全默认值不含命令。需要确定性测试的仓库必须在可信 patch 中配置；模型生成的命令被明确拒绝作为验证策略。文件系统 sandbox 不能阻止已配置命令修改远程服务，因此部署必须使用观察性命令，并另行限制网络凭据。
- **Auditor 工具有界**——随产品提供的 Auditor 可以读取、搜索文件与 session 证据，但不能调用 Bash 或有修改能力的工具。已配置命令可以覆盖确定性运行时检查；GUI 验收仍需观察工具或后续专用验证 provider。
- **没有 token 或价格预算**——轮次与总耗时已经有界，但 provider token 和价格统计还不是此模式的准入控制。
