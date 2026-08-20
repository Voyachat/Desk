# Aistaff 员工体验远程服务

[English](README.md) | 中文

本包通过 `employeeExperience` 命名空间下严格生成的 Typert 编解码器，对外暴露权威 Host（宿主）的 `ctx.employeeExperience` 服务。Host（宿主）的快照方法执行该服务的原子性观察和读取操作，并立即释放其临时观察资源。

Client（客户端）入口在注册 `ctx.employeeExperience` 之前，先获取并校验完整的 Host（宿主）基线数据。它维护一个 `loading` 状态的零代对象层，仅接受单调递增的完整替换，保留每一次变更操作的 `operation_id`，在成功变更后触发刷新，并将传输载体失败与专用于展示场景的安全错误值（`ProductError`）明确区分开来。本包的方法不涉及云游标（Cloud cursors）、快照租约（snapshot leases）、访问令牌（access tokens）以及传输层恢复状态（transport recovery state）。

## 模型体验

### 员工体验远程服务桥接器

#### 模型可见内容

无。该桥接器仅承载 Renderer（渲染器）业务投影读取与显式用户操作，不注册任何提示词（prompt）、工具（tool）或会话事件（Session event）。

#### Token 影响

无。没有任何远程载荷进入模型上下文。

#### KV Cache 影响

无。本包不修改模型请求。

## 已知限制与待办事项

- **不支持推送式替换流** —— 客户端在每次成功变更后均刷新完整快照。Host（宿主）拥有的云 SSE 回放（Cloud SSE replay）功能保留在云适配器（Cloud adapter）内，从不向 Renderer（渲染器）转发。
