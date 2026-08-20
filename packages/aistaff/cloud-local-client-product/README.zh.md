# Aistaff Cloud 与本地客户端产品

[English](README.md) | 中文

本包是面向 Aistaff Cloud AI 员工工作台（含本地能力）的严格 V2 生产版 `dsh.client` 入口。其 Host 端仅为一个空操作（no-op）标记；`lib/client.js` 将浏览器插件注册至 `@voyaseek-ai/dsh-aistaff-cloud-local-client-product`。

浏览器端源码仅复用生产环境 `@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts` 中的 `apply` 函数。它既不导入 Fixture 入口，也不探测服务以自动选择产品模式。加载器顺序要求：必须先加载 API 远程服务、员工体验远程服务、本地能力远程服务、客户端运行时、布局模块及侧边栏模块，再加载此包装层。随后，Cordis 注入机制要求 `slots`、`employeeExperience` 和 `localCapability` 三者必须同时就绪；因此，在启动竞争条件下，V2 无法注册纯云端工作台。

浏览器构建过程将所选生产环境源码与 CSS 内联，同时将 DSH 平台模块保留为加载器表（loader-table）中的外部依赖（externals）。CSS 虚拟模块标识符仅包含包身份与样式表文件名基名。经压缩的浏览器产物不含源映射（source map），且不携带任何 Host 监督器（Host Supervisor）、协调器（coordinator）、文件系统目标、路径、token 或套接字（socket）实现。

## 模型体验

### 严格的 V2 工作台组合

#### 模型所见内容

无直接可见内容。该包装层仅在已有的员工体验（Employee Experience）与本地能力（Local Capability）投影之上注册渲染器 UI（Renderer UI）。

#### Token 影响

无影响。本包不提供任何提示词（prompt）、工具 schema（tool schema）或模型输入。

#### KV Cache 影响

无影响。客户端组合逻辑不会修改模型请求。

## 已知限制与待办事项

- **无 Host 实现** —— 本包依赖已有的、由远程服务支撑的 `employeeExperience` 与 `localCapability` 服务，并且在缺失任一服务时会主动注册失败。
