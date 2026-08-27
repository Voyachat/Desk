# Agent Note：Codex driver scope 声明提示词组装使用的工具注册表

Status: implemented

[English](2026-08-21-codex-agent-tools-injection.md) | 中文

## Problem

Code Mode 中所有获准模型都会在 Codex app-server 进程启动前失败，并报告 `cannot get property "tools" without inject`。共享 system prompt 组装会收到当前 agent，并可能读取 `agent.ctx.tools`；`codex-agent` 既没有在插件 inject 列表中声明 `tools`，也没有把它放入每个 `CodexAgent` 捕获的 context。Cordis 因此在服务代理处拒绝这次属性访问。故障发生在所有模型共用的提示词组装阶段，切换所选模型、provider route 或 Codex 进程配置都无法修复。

## Decision

`@voyaseek-ai/dsh-codex-agent` 把 `tools` 声明为必需服务，并通过 `ctx.inject(['sessions', 'agents', 'tools'], ...)` 捕获 driver context。每个 `CodexAgent` 都使用这份注入后的 context 构造，因此 system prompt 贡献方对运行时允许的每个模型都能看到同一份 agent-scoped 工具注册表。

组装回归测试挂载真实 system prompt 与工具服务，配置两个获准模型，分别创建 Codex agent，并让两者都执行提示词组装。`agent/pre-step` 拒绝会在启动 Codex 子进程或发起 provider 请求前停止 turn；提示词 section 同时证明 `agent.ctx.tools` 可读并记录所选模型。因此测试覆盖共同故障点，不消耗凭据，也不把 mock provider 响应当作运行时证据。

## Alternatives considered

**修补 Aistaff 产品组装。** 否决，因为缺失声明位于 `codex-agent` 为 driver 构造的 context 内。产品 row 可以提供服务，但不能向另一个插件已经创建的 context 追加 inject 声明。

**为 Codex 特判提示词贡献方，使其不读取 `agent.ctx.tools`。** 否决，因为工具注册表是合法的 agent-scoped 提示词输入，其他贡献方也可能依赖它。隐藏访问会保留不完整的 driver context，并让行为取决于恰好安装了哪些提示词 section。

**按模型切换配置。** 否决，因为所有获准模型都会在解析进程命令前经过同一套提示词组装。复制 provider 或模型配置不会改变缺失的 Cordis 注入。

## Consequences

Codex runtime 现在显式依赖 `@voyaseek-ai/dsh-tools`；遗漏它的组装会在插件解析阶段失败，而不是等到第一次 turn。所有已配置 Codex 模型共享修正后的提示词 context，并继续使用各自所选的 provider/model route。回归证据在真实 app-server 请求前结束，因此 provider 鉴权和远端模型接受情况仍属于独立的端到端证据。
