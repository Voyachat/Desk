# AiDesktop

[English](README.md) | 中文

AiDesktop 是一个独立的桌面 AI 客户端，以 Voyaseek Harness 作为运行时和 Client 基座，并通过插件组装 Aistaff 产品能力。

## 当前状态

仓库包含隔离的 DSH 源码基线、Aistaff Client 插槽插件、本地 UI fixture、Host Remotes 与 bundles、Electron 打包代码，以及可运行的用户前端主流程演示。

- [架构](docs/architecture.zh.md)
- [开发指南](docs/development.zh.md)
- [可运行的前端主流程演示](apps/frontend-demo/README.zh.md)

真实的 Aistaff Client Gateway、登录和 Workforce 流程、Cloud Run 到 Material 投影、SSE replay、带签名的 employee package 激活、Supervisor 集成以及客户发布所需的安全要求尚未完成。Fixture 不会执行真实的云端员工任务或本地副作用。

## 开发模式

`pnpm run dev:aistaff` 使用隔离的 `.aidesktop-dev` profile 启动。该入口通过专用 overlay 启用动态 Cordis 插件 HMR，发布 profile 仍保持禁用。此 profile 下的动态插件定义和最近一次成功的 JavaScript 构建保存在 `$VOYASEEK_HOME/dynamic-cordis/`；可编辑源码位于 `sources/<pluginId>/host.ts` 和 `sources/<pluginId>/client.tsx`。

## 运行

AiDesktop 通过仓库中的隔离开发 profile 运行。

### 从源码运行

安装受支持的 Node.js 版本和 pnpm，然后执行：

```sh
pnpm install
pnpm run build
pnpm run dev:aistaff
```

开发命令会从仓库源码启动使用隔离开发 profile 的 AiDesktop。

## 贡献与许可证

仓库规则见 [AGENTS.md](AGENTS.md)，贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。本仓库使用 [MIT License](LICENSE)，第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
