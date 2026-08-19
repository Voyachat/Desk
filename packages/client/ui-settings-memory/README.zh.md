# @voyaseek-ai/dsh-client-ui-settings-memory

[English](README.md) | 中文

独立于设置外壳的 `settings.section` 页面，用于启用、搜索、检查、删除、清空和打开有界本地记忆文档。它只依赖稳定 slot 与 loopback Settings API，因此设置界面从弹窗重写为全框架视图时不会改变其数据合同。

非 loopback 连接不会注册该页面。写入携带 `expectedRevision`，监听页面 `settings/document-updated`，关闭功能时保留条目，并在删除单条或清空全部前要求 `RiskConfirmation`。页面不会收到 Host 路径；无路径的 `settings.openDocument` 操作由 Host 打开其自有设置文档。

## 模型体验

无，因为本包渲染浏览器设置页面；每条模型可见召回消息都由 agent-memory context Consumer 持有。

#### KV Cache 影响

没有直接影响；修改或删除条目只影响未来召回决策。

## 已知限制与暂缓事项

- 非 loopback 连接有意不提供该页面。
- 由于有界 Provider 持有共享 Settings 文档中的一个 namespace，“打开记忆文件”会打开整份设置文档。
