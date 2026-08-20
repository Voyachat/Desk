# @voyaseek-ai/dsh-client-ui-brand-official

[English](README.md) | 中文

这个可选通用包仅在 `DSH_CLIENT_BUILD_PROFILE` 为 `official` 时，用上游官方 DSH 图稿填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`。产品发行版可以由产品自有 Client 插件使用更小的数值优先级覆盖这些 occupant。

三个 occupant 通过嵌套的 `slots.inject()` 作为一组声明感知注册安装。因此无论该包条目先于还是后于侧边栏和会话声明方激活，它都能工作；任一声明折叠时会撤回全部 occupant，HMR 期间不会留下混合品牌。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **本包只提供上游 occupant 集合** —— 产品品牌应由产品自有 Cordis 包以显式优先级占用相同 slot。
- **浏览器标题相互独立** —— `DSH_CLIENT_TITLE` 在构建期选择标题文字，而不经过 UI slot。
