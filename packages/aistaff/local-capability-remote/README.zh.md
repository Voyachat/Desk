# Aistaff 本地能力远程服务

[English](README.md) | 中文

本包通过 `localCapability` 命名空间下的生成式 Typert 编解码器，对外暴露权威 Host 的 `ctx.localCapability` 服务。`getSnapshot()` 方法执行一次原子性的观察/读取操作，并立即释放临时观察资源。所有暴露的输入与返回结果均采用公共 DTO 包 `@voyaseek-ai/dsh-aistaff-local-capability/types`；第二道协议防护机制会拒绝二进制数据、文件系统路径、传输字段、token 字段以及派生于 `FsTarget` 的值。

客户端入口在注册 `ctx.localCapability` 之前，先完整获取 Host 基线状态。成功的选项选择、授权、撤销及操作一致性校验均保留原始 `operation_id`，并拉取一份完整的替代内容。替代内容不得降低代次（generation），亦不得以相同代次复用不同内容。

## 模型交互体验

### 本地能力远程服务桥接器

#### 模型可见内容

无。该桥接器仅承载显式的用户授权操作及面向展示安全的投影数据，不注册任何提示词、工具或会话事件。

#### Token 影响

无。远程载荷不会进入模型上下文。

#### KV Cache 影响

无。本包不修改任何模型请求。

## 已知限制与待办事项

- **不支持推送式替代流** — Typert Remote 不转发进程内 `observe()` 回调。V2 版本在每次成功变更及 `readOperation()` 一致性校验后刷新；与当前操作无关的 Host 变更，仅在下一次显式刷新点生效。
