# @voyaseek-ai/dsh-complex-goal

[English](README.md) | 中文

为复杂目标提供独立环境验证。根 Agent 可以从任何语言的直接用户请求语义中选择 `complex_goal`；`/goal-complex <objective>` 仍作为显式 Web 命令保留。插件复用 `ctx.goals` 管理目标生命周期、复用所属 session 日志持久化状态，并通过 fresh in-process subagent 分别运行 Manager、Executor 与 Auditor。设计采用[开源采用台账](../../../.open-source/adoptions.yaml)记录的 MIT 许可 LongHorizon-Harness 基线中的 Manager–Executor–Auditor 职责划分；不嵌入上游 Python 运行时、文件账本、Dashboard 或源代码。

## 行为

Manager 只接收不可变目标与最新 Auditor 可信状态，不获得环境工具；它选择一个有界合同或要求直接审计。Executor 在 fresh session 中接收合同，并按父 session 现有权限策略修改工作区；其结构化报告只是未经验证的声明。

Auditor 启动前，宿主会通过 `ctx.shell` 在显式文件系统 `read-only` sandbox policy 下运行 `verificationGates` 中的每条命令。不支持 sandbox 的执行器会在命令运行前被拒绝。命令、有界输出、退出状态与 sandbox 事实会被持久化；非零退出、超时、sandbox 拒绝、runner 失败或缺少只读 sandbox 回报都会使检查失败。模型不能提供或修改这些命令；只有全部已配置检查通过，任务才可能完成。

Auditor 在另一个 fresh session 中启动。provider-owned 创建 hook 会在发布前追加 `sandbox/mode: read-only`，共享委派路径把审批固定为 `never`；固定白名单还把 Auditor 限制在父级实际存在的观察工具。只有 `status: complete`、`integrity: clean` 与 `alignment: aligned` 同时成立，并且确定性检查已通过，才提交完成。Auditor 在检查失败时声称完成，不能替换可信状态。每次被接受的审计都会完整替换后续 Manager 可以读取的可信 requirement、artifact、fact 与证据状态。

每次转换都向父 session 追加完整的 version-2 `complex-goal/change` 快照，并在下一次可能产生副作用的 Executor 启动前完成持久化刷新。快照会冻结 `verificationGates`、有界证据大小、开始时间与总耗时截止点，因此重启不能静默削弱当前目标。插件创建目标后会同步解除普通同会话 goal driver 的自动续行权限。中断状态会记录显式 `/goal-complex resume` 应继续规划还是先审计当前环境。持久状态若停在 executing 或 auditing，恢复同样先验证和审计，绝不盲目重试结果未知的副作用。

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

命令顺序稳定，每条已配置命令每轮运行一次。重启后，活跃目标继续使用已持久化的计划；配置变更只影响之后的新目标。

## 扩展点

本包消费现有 goal、session、shell、subagent、tool、sandbox-policy、approval、system-prompt 与 command 服务。它复用 goal tool 的直接用户权限检查，只注册一个私有 `complex-goal-auditor` in-process provider，通过共享 driver 应用只读子 Agent setup；不暴露第二套 workflow engine，也不修改 `agent-loop`。

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

- **前台激活**——持久快照可跨重启保留，但只有用户显式执行 `/goal-complex resume` 才继续；当前没有调度器或后台 job 标识。
- **不自动回滚**——Auditor 否决 Executor 声明前，Executor 可能已经修改工作区。否决会阻止认证完成，但不会撤销文件系统效果。
- **验证由项目配置**——安全默认值不含命令。需要确定性测试的仓库必须在可信 patch 中配置；模型生成的命令被明确拒绝作为验证策略。文件系统 sandbox 不能阻止已配置命令修改远程服务，因此部署必须使用观察性命令，并另行限制网络凭据。
- **Auditor 工具有界**——随产品提供的 Auditor 可以读取、搜索文件与 session 证据，但不能调用 Bash 或有修改能力的工具。已配置命令可以覆盖确定性运行时检查；GUI 验收仍需观察工具或后续专用验证 provider。
- **没有 token 或价格预算**——轮次与总耗时已经有界，但 provider token 和价格统计还不是此模式的准入控制。
