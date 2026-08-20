# Agent Note：在不激活的情况下封装持久化 Supervisor 控制能力

[English](2026-08-15-aistaff-supervisor-durable-control.md) | 中文

状态：已实现

## 问题

`capability_only` 消费流程已经通过仅用于测试的内存 Supervisor 对外可见，而迁移后的 Rust sidecar 刻意拒绝生产文件读取。启用这条遗留路径会信任调用方提供的准入信息、在重启后丢失操作结果，并且不返回权威 Receipt。桌面端在 Aistaff 提供签名产物、设备证明和确认协议之前，也不能激活 Cloud 本地操作。

## 决策

AiDesktop 为 Rust sidecar 增加独立的 `aidesktop.supervisor-control.v1` 路径。Host 在启动时仅通过继承的 stdin 传递一次每次启动令牌，随后开始经过认证且有界的 JSONL 通信。严格的 `SupervisorControlPort` 进程 Provider 只映射六个已冻结的控制方法，并在传输结果不确定时保留原始操作身份；它绝不在 TypeScript 中创建 Receipt 或身份。

显式构造的 Rust 控制运行时只接受 `capability_only` 上下文，以及有界的 `file/read_text` 或 `directory/list`。它在返回前把 Grant、Receipt、操作指纹和有界回放结果持久化到版本化 SQLite Store。规范路径和回放结果使用注入的 AES-256-GCM 数据密钥加密；不安全的状态目录、外部或未知 schema、错误密钥、被修改的密文、陈旧上下文、变更目标和请求冲突都会失败关闭。

发布 sidecar 被打包为经过验证的物理可执行文件，但保持休眠。默认构造器不接收 Store 数据密钥，也不声明控制能力；现有生产文件服务保持禁用；桌面端 `aistaff` profile 不加载进程 Provider。生产激活需要操作系统 Secure Store 密钥、官方 Aistaff 产物和设备证明，以及 Cloud Receipt 确认与对账。

## 已考虑的替代方案

我们否决了翻转遗留执行标志，因为其产物准入和内存回放不能作为生产证据。我们否决了 TypeScript Receipt 日志，因为 Supervisor 拥有本地副作用和恢复。我们选择已采用的 SQLite 事务和 schema 设施，而不是手写追加日志。我们也否决了通过 argv 或普通环境变量传递启动令牌，因为这些位置在继承进程信道之外仍可被观测。

## 影响

仓库现在拥有可独立测试的生产级本地执行前置能力，并且可以在不提前暴露客户能力的情况下完成打包。重启回放、请求冲突、存储篡改、路径约束、进程生命周期、二进制闭包和浏览器隔离仍可分别验证。下一个生产切片是集成工作，而不是另一个文件系统执行器：从操作系统 Secure Store 注入 Store 密钥，绑定官方产物和经证明的设备身份，增加 Cloud 确认与对账，然后明确启用生产 bundle。当前义务由 [API](../../../../Doc/API.md#3-hostsupervisor)、[架构](../../../../Doc/架构.md#4-客户端执行形态)、[数据](../../../../Doc/数据.md#42-supervisorstatestore) 和 [V2 任务](../../../../Doc/tasks/V2-capability-only-read.md) 负责。
