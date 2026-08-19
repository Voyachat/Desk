# @voyaseek-ai/dsh-agent-memory-settings

[English](README.md) | 中文

默认本地 Provider。它在现有可编辑设置文档中维护有界记忆条目，并串行执行采集、召回、删除和清空。

| 配置 | 默认值 | 含义 |
| --- | ---: | --- |
| `enabled` | `true` | 启用两条自动路径；关闭时不删除条目。 |
| `autoCapture` / `autoRecall` | `true` | 控制已完成轮次写入与后续会话读取。 |
| `maxEntries` | `200` | 超出上限前先淘汰最旧条目。 |
| `maxHits` | `5` | 限制单次召回结果数。 |
| `maxContentChars` / `maxTitleChars` | `4000` / `120` | 按 Unicode code point 限制每条持久内容。 |

Provider 使用 `(session id, turn)` 生成确定性采集标识，对项目条目执行精确 workspace 匹配，以中文 bigram 与 ASCII 单词做词法排序，并复用既有 Settings 写队列实现串行化。数据位于 `$VOYASEEK_HOME/settings.yaml` 的 `agent-memory` 分节，因此“打开记忆文件”会打开共享用户设置文档。

## 模型体验

通过 agent-memory context Consumer 间接产生影响；该 Consumer 把存储结果渲染为已记录的召回消息。

#### KV Cache 影响

存储本身不增加内容；召回消息通过 Consumer 改变请求后缀。

## 已知限制与暂缓事项

- 整份设置文档写入与词法检索面向有界单用户桌面存储。
- 共享或远程多用户 Host 必须使用带身份作用域的 Provider。
- 更大个人存储可换成专用 SQLite，集群可换成加固后的远程 Provider，两者都无需改写 Consumer；不持有 Settings namespace 的 Provider 必须提供自己的特权管理适配器。
