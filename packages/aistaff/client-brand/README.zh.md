# @voyaseek-ai/dsh-aistaff-client-brand

[English](README.md) | 中文

本包是 Aistaff 产品中 Voyaseek 浏览器品牌呈现的唯一所有者。Aistaff product bundle 在通用 DSH Web bundle 之后安装本包；本包以更高优先级填充 `sidebar.brand.mark`、`sidebar.brand.name` 和 `conversation.hero.brand.mark`，不替换上游 slot 声明或 shell 组件。

Host 半边是空的 Loader seat。Client 半边把三个 occupant 作为一组声明感知注册安装，因此 HMR 或声明卸载不会留下混合品牌。

## 模型体验

无，因为本包只贡献浏览器呈现；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- **静态文件仍由应用交付** —— 组装后的 Web 应用负责提供本包引用的明暗 PNG 文件。
- **浏览器元数据相互独立** —— favicon 和文档标题仍由组装后的产品应用负责。
