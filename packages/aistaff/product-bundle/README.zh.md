# Aistaff 产品组合包

[English](README.md) | 中文

本包是在现有 DSH `base` 和 `web-app` 组合包之上叠加的 Aistaff 产品层。它挂载 Host 产品投影与浏览器产品插件，但不替换 DSH agent loop、侧边栏、对话、工作区、轨迹或设置 owner。

请把它作为 AiDesktop Profile 的最后一个组合包。移除这一层会恢复未经修改的 DSH 产品界面。

## 模型体验

无，因为本包只组合由各 owner 自行声明模型可见行为的 Host 和 Client 插件。

#### KV Cache 影响

本包没有直接影响；被组合的运行时 owner 决定模型请求的缓存影响。

## 已知限制与暂缓事项

- **仅支持 fixture 组合** — 当前组合包挂载本地投影和 Client 界面。生产组合包必须注入 Client Gateway 适配器，且不得静默 fallback 到本地 Task 状态。
