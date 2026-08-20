# Aistaff Supervisor 进程

[English](README.md) | 中文

该仅限宿主（Host）使用的包用于启动打包后的 `aistaff-desktop-supervisor` Rust 二进制程序，生成一个每次启动时均全新的认证令牌，并通过子进程的标准输入与标准输出传输大小受限的 JSONL 请求。宿主在继承的标准输入管道上，于首个 JSONL 帧之前、仅一次地写入该令牌作为初始化引导行；该令牌绝不会出现在命令行参数（argv）、子进程环境变量、返回值或日志中。

该传输协议仅接受以下请求：`hello`、`health`、`shutdown`；控制平面请求 `control.hello`、`control.grant.register`、`control.grant.revoke`、`control.capability.read`、`control.receipt.get` 和 `control.operation.read`；以及下方进程边界内仍在使用的遗留本地文件命令。所有进程、浏览器、工作区写入、消息缓存及 MCP 命令，在 JSONL 帧写入前即被拒绝。请求与响应大小上限为 64 KiB，响应须严格匹配对应请求的身份标识；若发生超时、EOF、无效 UTF-8、JSON 格式错误、协议漂移或响应不匹配等情况，则连接将立即失败关闭。

`apply()` 方法在发布 `ctx.aistaffSupervisorProcess` 之前，对 `hello` 请求执行认证。其 Cordis 效果处置器（effect disposer）会发送已认证的 `shutdown` 请求，在配置的时限到期后强制终止子进程，并等待子进程退出完成。所有错误信息仅包含稳定的宿主端与 Rust 端错误码，绝不包含有效载荷（payload）、路径、子进程标准错误输出（stderr）或环境变量值。

本包是 `@voyaseek-ai/dsh-aistaff-supervisor-control-process` 下层的进程传输实现；它既不实现 `SupervisorControlPort` 服务定义（Service Definition），也不在控制命令与遗留命令之间进行选择。该基于进程的提供方（process-backed provider）仅使用 `control.*` 类操作，且绝不会将遗留命令的结果适配为 Receipt 或执行身份标识（execution identity）。

## 模型体验

### Supervisor 伴随传输（sidecar transport）

#### 模型所见内容

模型无法直接感知任何内容。消费方（Consumer）必须先通过 `SupervisorProcessService` 将数据记录到所属 DSH 会话（DSH Session）中，然后才能将该数据纳入模型请求。

#### 令牌效应（Token effect）

无。本包不贡献任何提示词（prompt）或工具 schema（tool schema）。

#### KV Cache 效应

无。启动或调用宿主侧伴随进程（Host sidecar）不会影响模型请求。

## 已知限制与待办事项

- **该传输层不承载控制语义** —— `@voyaseek-ai/dsh-aistaff-supervisor-control-process` 才负责定义严格的公开请求/响应映射、仅限能力（capability-only）的访问限制，以及协调失败（reconciliation error）的行为。
