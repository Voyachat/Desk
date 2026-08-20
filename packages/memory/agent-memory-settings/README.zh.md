# @voyaseek-ai/dsh-agent-memory-settings

[English](README.md) | 中文

默认本地 Provider。Settings 只持有实时控制项；结构化条目和提炼 outbox 位于 owner-only 的 `$VOYASEEK_HOME/memory/agent-memory.sqlite`。

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `enabled` | `true` | 启用两条自动路径；关闭时不删除条目。 |
| `autoCapture` / `autoRecall` | `true` | 控制已完成轮次写入与后续会话读取。 |
| `maxEntries` | `2000` | 超出本地产品预算时淘汰最久未更新的结构化条目。 |
| `maxHits` | `5` | 限制单次召回结果数。 |
| `maxContentChars` / `maxTitleChars` | `2000` / `120` | 按 Unicode code point 限制每条持久内容。 |
| `eventTtlDays` | `30` | 让有时效的 event 记忆过期。 |
| `maintenanceBatchSize` / `maintenanceMaxAttempts` | `4` / `5` | 限制一次后台处理量与失败提炼重试次数。 |

在任何持久写入或提炼调用前，Provider 会拒绝疑似凭据、Bearer token、private key 或 secret 赋值的轮次。其余轮次进入以 `(session id, turn)` 幂等的 outbox。成功维护按 `workspace + kind + semantic key` 更新唯一条目，因此纠正会覆盖旧值，不会累积原始对话。召回结合提炼关键词、中文 bigram、ASCII term、置信度和更新时间。Settings 文档只含控制项，打开它不会暴露或编辑 SQLite 文件。

## 模型体验

通过 agent-memory context Consumer 间接产生影响；该 Consumer 把存储结果渲染为已记录的召回消息。

#### KV Cache 影响

存储本身不增加内容；召回消息通过 Consumer 改变请求后缀。

## 已知限制与暂缓事项

- 检索使用词法和关键词，而不是 embedding／vector search；默认桌面场景由自动召回与显式工具覆盖，不再引入一套索引 runtime。
- 项目作用域当前跟随可信 Session cwd；移动项目会形成新的本地作用域。
- 共享或远程多用户 Host 必须使用带认证身份作用域的 Provider。
