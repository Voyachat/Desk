# AiDesktop

以 DeepSeek Harness 为运行与 Client 基座、以插件方式装配 Aistaff 产品能力的独立桌面 AI 客户端。

- [最终构建方案](Doc/构建方案.md)
- [架构与运行模式](Doc/架构.md)
- [客户端/服务端 API 约定](Doc/API.md#2-aistaff-ai-员工客户端合同)
- [当前实施任务](Doc/tasks/README.md)
- [可运行的前端主流程 Demo](apps/frontend-demo/README.md)

当前已有隔离登记的 DSH 源码基线、Aistaff Client slot 插件、本地 UI Fixture/Host Remote/Bundle、Electron 封装代码和用户可见前端 Demo。真实 Aistaff Client Gateway、登录/Workforce、Cloud Run→Material、SSE replay、签名员工包激活、Supervisor 与客户发布安全门槛仍未闭合；Fixture 不执行真实云端员工任务或本地副作用。

开发态使用 `pnpm run dev:aistaff` 启动隔离的 `.aidesktop-dev` Profile。该入口通过独立 overlay 启用动态 Cordis 插件 HMR；发布 Profile 保持关闭。动态插件定义及最后成功构建的 JavaScript 持久化在该 Profile 的 `$DSH_HOME/dynamic-cordis/`，可编辑源码位于 `sources/<pluginId>/host.ts` 与 `sources/<pluginId>/client.tsx`。
