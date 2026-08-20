# Aistaff 产品 Remote

[English](README.md) | 中文

本包通过 `aistaffProduct` Remote 命名空间下严格生成的 Typert 编解码器，对外暴露权威的 `ctx.aistaffProduct` 操作。其 Client 入口注册 `ctx.aistaffProductPort`，解包承载信封，并在不维护第二份投影的前提下，完整保留产品业务结果。

宿主组合（Host composition）在产品投影加载完成后，再加载本包默认导出；客户端组合（Client composition）则在 API Remote 加载完本包生成的 `./remote` 贡献后，加载 `@voyaseek-ai/dsh-aistaff-product-remote/client`。

## 模型体验

### 产品 Remote 桥接器

#### 模型可见内容

无。该桥接器仅承载渲染器（Renderer）对产品的读取操作及用户动作，不注册提示词文本、工具或会话事件（Session event）。

#### Token 影响

无。请求与响应均不进入模型上下文。

#### KV Cache 影响

无。本包不会修改任何模型请求。

## 已知限制与待办事项

- **不支持 Fixture 事件转发** — `subscribe()` 方法有意不传递任何事件；验收用客户端（acceptance Client）需在每次变更后调用 `getSnapshot()` 主动刷新。生产环境云服务的重连与事件回放功能归属客户端网关适配器（Client Gateway adapter），不得复用此静默行为。
