# @voyaseek-ai/dsh-agent-memory-settings

[English](README.md) | 中文

默认本地 Provider。Settings 只持有实时控制项；结构化条目和提炼 outbox 位于 owner-only 的 `$VOYASEEK_HOME/memory/agent-memory.sqlite`。

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `enabled` | `false` | 仅在用户主动开启后启用采集与召回；关闭时保留已有条目。 |
| `autoCapture` / `autoRecall` | `true` | 控制已完成轮次写入与后续会话读取。 |
| `maxEntries` | `2000` | 超出本地产品预算时淘汰最久未更新的结构化条目。 |
| `maxHits` | `5` | 限制单次召回结果数。 |
| `maxContentChars` / `maxTitleChars` | `2000` / `120` | 按 Unicode code point 限制每条持久内容。 |
| `eventTtlDays` | `30` | 让有时效的 event 记忆过期。 |
| `maintenanceBatchSize` / `maintenanceMaxAttempts` | `4` / `5` | 限制一次后台处理量与失败提炼重试次数。 |

在任何持久写入或提炼调用前，Provider 会拒绝疑似凭据、Bearer token、private key 或 secret 赋值的轮次。只有直接用户文本会进入以 `(session id, turn)` 幂等的 outbox；Assistant 消息、工具输出、推理、系统文本和召回历史绝不会进入提炼。每个自动 upsert 或 delete 都必须携带包含在该采集用户文本中的精确佐证原话，Provider 会在事务写入任何内容前验证它。显式 `memory_remember` 工具对当前用户消息执行相同的原话要求。成功维护按 `workspace + kind + semantic key` 更新唯一条目，因此纠正会覆盖旧值，不会累积原始对话。召回结合提炼关键词、中文 bigram、ASCII term、置信度和更新时间。Settings 文档只含控制项，打开它不会暴露或编辑 SQLite 文件。

Provider 会在一个 SQLite 事务内按顺序升级受支持的旧 schema。Schema v2 可无损升级到 v3，保留已提交记忆和待处理用户文本，同时从待处理采集中移除已废弃的 Assistant 输出字段。任一步失败都会回滚整个升级，旧数据库保持不变。缺少完整迁移路径的版本（包括 v1）会在提供数据前被拒绝。停止所有 Host 后，`pnpm run memory:reset -- --backup [--home <directory>]` 会把不支持的数据库移动到 owner-only 的带时间戳备份；`--delete` 会永久 unlink 该文件。命令只接受 agent-memory application id 正确且 schema 不受支持的数据库，拒绝链接和 WAL／SHM sidecar，并且绝不修改会话日志或 Settings。下一次 Host 启动会创建空的当前 schema 数据库。

## 模型体验

通过 agent-memory context Consumer 间接产生影响；该 Consumer 把存储结果渲染为已记录的召回消息。

#### KV Cache 影响

存储本身不增加内容；召回消息通过 Consumer 改变请求后缀。

## 已知限制与暂缓事项

- 检索使用词法和关键词，而不是 embedding／vector search；默认桌面场景由自动召回与显式工具覆盖，不再引入一套索引 runtime。
- 项目作用域当前跟随可信 Session cwd；移动项目会形成新的本地作用域。
- 共享或远程多用户 Host 必须使用带认证身份作用域的 Provider。
- 无缝升级要求每个中间 schema 版本都有一项经过评审的事务迁移步骤；缺失任一步时，数据库保持不变，并要求备份或显式重置。
