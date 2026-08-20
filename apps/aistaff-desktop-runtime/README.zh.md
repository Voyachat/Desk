# AI Staff 桌面运行时

[English](README.md) | 中文

本私有部署清单负责管理嵌入桌面应用中的生产依赖闭包。`scripts/stage-runtime.mjs` 利用仓库的 pnpm 工作区部署生产包、实体化所有链接、将构建完成的 CLI 复制至 `runtime/apps/cli`、删除开发产物，以及移除非 macOS x86_64 平台的 `node-pty` 预构建，并在原子替换 `runtime/` 前验证 Web 资源、AI Staff Client 插件、language-policy 运行时分片、worker 入口、`node-pty` 许可证及目标平台预构建。

Electron Forge 将暂存目录复制为 `app.asar` 外部的 `Contents/Resources/runtime`。验证过程拒绝体积超过 470 MiB 或包含超过 27,000 个普通文件的运行时，并以 JSON 同时报告这两项测量结果。这些预算覆盖整个暂存目录；依赖增长必须保持在预算内，否则必须基于实测的打包运行时给出理由并更新常量。该目录是生成产物，任何 DSH 运行时包发生变更后都必须重新构建。暂存操作必须串行执行：pnpm 的 legacy deploy 可能替换工作区链接，因此调用 Electron Forge 或其他工作区命令前必须恢复仓库的 pnpm 安装。

[`startup-policy.json`](./startup-policy.json) 是桌面冷启动粗粒度分类和 required 字节预算的唯一权威文件。本地 HTML、CSS、JavaScript 以及构建后的 Desktop `.js`/`.cjs` 文件必须在可交互前就绪。完整 managed runtime 延迟到启动壳显示后加载；该策略不再细分 Host 插件阶段。除 `darwin-x64` 外的所有 `node-pty` 预构建均被排除。普通 Desktop 编译使用 `node scripts/verify-startup-policy.mjs --required-only` 检查生成后的启动代码；打包前使用不带该标志的命令继续检查生成后的运行时。两种形式都只输出一条 JSON 摘要。
