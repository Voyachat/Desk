# Aistaff Cloud 客户端产品

[English](README.md) | 中文

本包是 Aistaff Cloud AI 员工工作台的显式生产 `dsh.client` 入口。Host 部分是 no-op 标记；`lib/client.js` 以 `@voyaseek-ai/dsh-aistaff-cloud-client-product` 注册浏览器插件。

浏览器源码只复用 `@voyaseek-ai/dsh-aistaff-client-product/src/cloud-client/index.ts`。它不会导入 Fixture `./client` 入口，也不会通过服务探测选择产品模式。包含本包的组合包必须先加载 `employee-experience-remote`。

本包提供独立浏览器构建，因为共享客户端 preset 会拒绝跨插件 runtime import。构建会内联选定的 Cloud 源码和 CSS，同时保留 DSH 平台模块作为 loader-table externals。

## 模型体验

无，因为该浏览器组合只注册产品 UI，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与待办事项

- **组合顺序** —— 所属 bundle 必须先加载 `employee-experience-remote` 再加载本包；该客户端入口不会探测或回退到其他产品模式。
