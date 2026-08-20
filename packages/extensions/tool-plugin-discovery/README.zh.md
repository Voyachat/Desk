# @voyaseek-ai/dsh-tool-plugin-discovery

[English](README.md) | 中文

只读的 `find_dsh_plugin` 工具搜索 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的机器可读目录。本包基于 `dsh-find-plugin` 的提交 `e75dc2ee10567789a5273e13ee8db62ae285a725` 改造；当前保留精选目录发现，刻意不移植上游的实时 GitHub 搜索层和可执行安装命令，直到 CLI 能对每个来源完成固定版本和审计。

目录字段在使用前会被验证。每个插件实例只缓存一份已验证目录，缓存时间由 `cacheTtlMs` 决定；刷新失败会让本次调用失败，不会把过期或异常数据伪装成当前结果。每个结果都带有 `reviewStatus: "unreviewed"`，因为进入目录不代表通过安全审查。

| 配置 | 默认值 | 含义 |
|---|---:|---|
| `catalogUrl` | `https://awesome-dsh-plugin.com/plugins.json` | 机器可读精选目录。 |
| `requestTimeoutMs` | `10000` | 协作式请求超时。 |
| `cacheTtlMs` | `3600000` | 已验证内存目录的保留时间。 |

## 模型体验

### 工具 Schema 与结果

#### 模型看到的内容

模型会看到生成的 [`find_dsh_plugin` schema](../../../docs/tool-catalog.md#voyaseek-aidsh-tool-plugin-discovery)，参数包括 `query`、可选 `limit` 和可选 `language`。结果包含源码元数据和可选的软件包规格，始终标为 `unreviewed`；渲染结果明确要求安装前检查源码、通过 DSH 插件审计并获得用户确认。

#### Token 影响

工具可见时有固定 Schema 成本；每次调用会追加随结果数量变化的文本。

#### KV Cache 影响

工具定义和可见性不变时前缀稳定；每次结果追加在可复用前缀之后。

## 已知限制与延后工作

- **没有离线快照** — 目录发现依赖配置的端点；本包不会把上游 87 KB 快照复制到每个构建中。
- **精选条目尚未审计** — 来源固定、归档检查、依赖分析和安装批准由 CLI 安装闸门负责。
- **没有 GitHub 社区层** — 在速率限制和精确提交审查能同时得到保证前，不返回精选目录之外的仓库。
