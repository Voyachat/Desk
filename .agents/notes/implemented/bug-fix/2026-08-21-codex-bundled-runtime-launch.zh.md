# Agent Note：Codex 使用随包 Runtime 与当前模型路由

Status: implemented

[English](2026-08-21-codex-bundled-runtime-launch.md) | 中文

## Problem

桌面 Runtime 会把锁定版本的 `@openai/codex` 及其平台专用 native payload 安装到私有 `node_modules`，但 Codex Driver 启动的是裸命令 `codex`。Electron 不会把这个私有 `.bin` 目录加入 Runtime 进程的 `PATH`，因此即使应用已经携带所需 binary，每个 Codex 轮次仍可能以 `spawn codex ENOENT` 失败。

当所选 provider id 与已配置默认值相同时，轮次解析还会跳过 `resolveExternalRuntimeRoute`。设置更新可以保持 provider id 不变，同时改变 endpoint 或凭据引用，导致 Codex 继续使用陈旧的启动配置。此外，替代 Driver 从未声明 `tools` 服务的插件 Context 创建 agent-scoped dispatch，而工具感知的 Agent 扩展需要该服务。

## Decision

Driver 直接从锁定版本 `@openai/codex` 所拥有的平台 optional dependency 解析默认 executable。平台与架构使用和上游 launcher 相同的 6 个包别名及 target triple，所得绝对路径指向 `vendor/<target>/bin/codex[.exe]`。不支持的主机、缺失的 optional package 与缺失的 native executable 会在轮次启动前给出 Codex 专用配置错误。完整 `argv` override 仍具有最高优先级，其次是显式 `executable`，最后才是随包 native binary。

每个已选择的 provider／model 请求都会先向 `dsh-llm` 查询当前 Codex 兼容的 external Runtime 路由。即使 provider id 与已配置默认值相同，返回的路由仍提供当前 endpoint 与凭据引用。若路由不存在，已配置默认 provider 继续使用静态回退；不同 provider 仍会在进程启动前失败。

Codex 插件把 `tools` 声明为注入的 peer service，使 agent-scoped 扩展获得已授权访问 ToolRuntime 的 Context。

## Alternatives considered

- **把 Runtime 的 `.bin` 目录加入 Electron 的 `PATH`。** 这会让启动正确性依赖产品专用环境修改，并保留一个隐藏要求：非桌面宿主也必须复现相同路径设置。Codex 包已经能够标识它拥有的准确 native payload。
- **运行 JavaScript `@openai/codex` launcher。** 这会增加不必要的 wrapper process，并要求在打包环境中选择 Node executable。直接解析 native descendant 能保持 subprocess 所有权与终止链路直接可控。
- **要求全局安装 Codex。** 产品已经携带锁定版本。回退到宿主命令会让行为依赖无关的安装及版本。
- **始终要求动态 LLM 路由。** 静态 `provider`、`baseUrl` 与 `apiKeyEnv` 仍是受支持的独立组合。只有选择非默认 provider 时才必须存在已注册的动态路由。

## Consequences

桌面 Codex 轮次不再依赖继承的 shell 路径配置。有意使用其他 executable 的部署继续保留现有 override。损坏或不受支持的随包安装会尽早失败，并在错误中指明缺失的 package 或 executable。

同名 provider 的模型选择会在下一轮使用当前设置元数据与凭据。新增的 `tools` peer dependency 明确了 Driver topology，并阻止 agent-scoped 工具扩展以 `cannot get property "tools" without inject` 失败。

## Testing

配置测试会解析已安装的 native binary、固定平台映射、保留显式 argv 与 Windows batch 处理、拒绝不支持或缺失的 payload，并证明同名 provider 请求会刷新 endpoint 与凭据元数据。真实 Cordis 组合测试在通过 AgentLoop 创建 Codex Driver 的同时固定所声明的 ToolRuntime 注入。
