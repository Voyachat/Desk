# Agent Note：复杂目标的持久调和

状态：已实现

[English](2026-08-20-durable-complex-goal-reconciliation.md) | 中文

## 问题

`complex-goal` 已经持久化独立验证过的轮次状态，但进程重启后仍需执行 `/goal-complex resume`，每个子 Agent 都继承源 session 的 cwd，进程内 Jobs 也无法协调冷 session。因此无人值守任务会停在进程边界；Auditor 报告失败前，被否决的 Executor 还可能已经修改源文件。

## 决策

所属 Session 日志仍是唯一持久任务权威。Version-3 `complex-goal/change` 快照增加冻结的任务工作区与有界重试状态。存在 session persistence 时，插件轮询廉价 revision，只检查发生变化的冷日志，并通过 `ctx.agents.resume()` 与 `Agent.runMaintenance()` 调和 planning、executing、auditing 或 paused 目标。live Agent registry 在单进程内阻止重复激活。自动失败会提交带指数退避的 `retry` 转换；连续尝试达到配置上限后阻塞 goal。blocked goal 不会自动恢复。恢复的 executing 或 auditing 阶段仍会在另一个 Executor 前执行确定性验证与只读 Auditor，因此重试调度不会削弱现有的未知副作用规则。

工作区隔离在创建 goal 前解析。`auto` 只为干净源目录创建 detached Git worktree，否则持久记录明确的共享工作区原因；`required` 则失败。现有 in-process subagent driver 增加窄的 provider-owned `cwd` 选项，让私有 Executor 与 Auditor 使用冻结的任务目录，而不改变父 Session。所有 gate 与 Auditor 接受完成后，可信宿主代码针对冻结 commit 生成有界 binary diff，并只在 `git apply --check` 通过后应用。源 HEAD 移动或冲突会阻止完成并保留 worktree。reverse-apply 校验使 patch 已应用但完成事件尚未写入时的崩溃恢复保持幂等。

这是对 OpenAI Symphony commit `8001b52e3062495a16e520e4ceaf8f9de868c4d0`（Apache-2.0）的架构采用：保留 poll/reconcile/retry 与逐任务 workspace，不复制其 Elixir runtime、tracker 权威、Codex App Server client、hooks 或 Dashboard。持久源码评审位于 `/Users/baron/projects/开源代码/_reviews/github.com--openai--symphony/README.md`；AiDesktop 不运行时依赖该本机路径。

## 结果

符合条件的持久复杂目标可在重启后无需命令继续，重试时间也能再跨一次重启。干净 Git 任务会隔离 Executor 修改，并只发布独立验收通过的 patch；非 Git 或脏任务仍可用，但会显示降级原因。实现没有增加第二套 workflow engine、通用持久调度器或 `agent-loop` 分支。

协调器是单进程组件，不是分布式 lease 服务；一个可写 persistence root 必须只对应一个 harness 协调器。worktree 会保留，后续仍需清理与配额界面。文件系统 patch 恢复不为远程 API 提供 exactly-once；有修改能力的工具仍需 provider 幂等与可审计回执。`auto` 无法在不丢失用户状态或自行发明 merge 权威的前提下隔离已有脏源目录，因此会明确继续使用共享 cwd。

## 备选方案

没有依赖或 Fork Symphony，因为它会重复 Session、Agent、Codex runtime、workflow 与 UI 权威。在出现第二个真实消费者前，没有抽象通用持久任务服务；窄的 complex-goal 调度器代码更少，未来仍可在不改变持久事件的前提下提取。没有把进程内 Jobs 当作重启权威。没有修改 `agent-loop`，因为 Agent factory resume 与 maintenance 已提供所需生命周期。也没有复制任意目录，因为 ignored 依赖、大型资产、symlink 与回写语义会形成第二套文件系统实现。
