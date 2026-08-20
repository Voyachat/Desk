# Aistaff 产品投影

[English](README.md) | 中文

本包提供 `ctx.aistaffProduct`，即 UI 接受性测试前置数据（fixture）端口的可替换内存驻留型 Host 实现。其必需的 `employees` 配置项显式声明了初始服务目录。每条被接受的命令均先完整追加一个事件，再发布该事件；`projectProductEvents()` 函数则从事件历史中重建出完全一致的状态快照。

## 模型交互体验

无。该投影属于 Host 产品服务，不提供任何提示词（prompt）片段、模型消息（model message）或工具 schema（tool schema）。

#### KV Cache 效应

无；投影值不会进入任何模型请求。

## 已知限制与待办事项

- **仅支持进程内存级 fixture** —— 重启持久化、云端同步及真实任务执行功能均被有意省略；生产环境下的组合逻辑必须注入云端适配器（Cloud adapter），且不得静默回退至本提供方。
