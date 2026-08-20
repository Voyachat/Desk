# AiDesktop

[English](README.md) | 中文

AiDesktop 是一个独立桌面 AI 客户端，以 Voyaseek Harness 作为运行时和 Client 基座，并通过插件装配 Aistaff 产品能力。

## 当前状态

本仓库包含隔离的 DSH 源码基线、Aistaff Client slot 插件、本地 UI fixture、Host Remote 与 bundle、Electron 封装代码，以及可运行的用户可见前端 Demo。

- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [可运行的前端主流程 Demo](apps/frontend-demo/README.md)

真实 Aistaff Client Gateway、登录与 Workforce 流程、Cloud Run 到 Material 的投影、SSE replay、签名员工包激活、Supervisor 集成和客户发布安全要求尚未完成。Fixture 不执行真实云端员工任务或本地副作用。

## 开发模式

`pnpm run dev:aistaff` 启动隔离的 `.aidesktop-dev` profile。该入口通过专用 overlay 启用动态 Cordis 插件 HMR，发布 profile 则保持关闭。动态插件定义及最后成功构建的 JavaScript 持久化在该 profile 的 `$VOYASEEK_HOME/dynamic-cordis/` 下；可编辑源码位于 `sources/<pluginId>/host.ts` 与 `sources/<pluginId>/client.tsx`。

## 运行

AiDesktop 通过隔离的开发 profile 从本仓库运行。

### 从源码运行

安装受支持的 Node.js 版本与 pnpm，然后运行：

```sh
pnpm install
pnpm run build
pnpm run dev:aistaff
```

开发命令使用隔离的开发 profile，从仓库源码启动 AiDesktop。
