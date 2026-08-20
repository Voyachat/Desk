# AI Staff 桌面运行时

[English](README.md) | 中文

本私有部署清单负责管理嵌入桌面应用中的生产依赖闭包。`scripts/stage-runtime.mjs` 通过 pnpm modern deploy 在离线模式下使用仓库锁文件，注入 workspace 包但不执行部署期 lifecycle script，随后实体化所有链接、恢复 `node-pty` `spawn-helper` 的可执行权限，并删除包管理器元数据、开发产物及非 macOS x86_64 平台的预构建。

暂存在原子替换 `runtime/` 前验证 Web 资源、AI Staff Client 插件、language-policy 运行时分片、worker 入口、原生包导入、`node-pty` 许可证及目标平台预构建。

Electron Forge 将暂存目录复制为 `app.asar` 外部的 `Contents/Resources/runtime`。验证过程拒绝体积超过 800 MiB 或包含超过 27,000 个普通文件的运行时，并以 JSON 同时报告这两项测量结果。这些预算覆盖整个暂存目录；当前闭包包含 macOS x86_64 的 Codex 与 Claude 运行时，因此依赖增长必须保持在预算内，否则必须基于实测的打包运行时给出理由并更新常量。

该目录是生成产物，任何 DSH 运行时包发生变更后都必须重新构建。必须先完成仓库根目录的 pnpm install 和全仓构建：暂存会有意跳过依赖 lifecycle script，并在 Electron Forge 使用运行时前证明最终物理闭包中的 `koffi` 与 `node-pty` 可以加载，再通过真实 PTY 启动 `/bin/sh`，要求输出 marker、退出码为 0 且在 3 秒内完成。

[`startup-policy.json`](./startup-policy.json) 是桌面冷启动粗粒度分类和 required 字节预算的唯一权威文件。本地 HTML、CSS、JavaScript 以及构建后的 Desktop `.js`/`.cjs` 文件必须在可交互前就绪。完整受管运行时延迟到启动壳显示后加载；该策略不细分 Host 插件阶段。除 `darwin-x64` 外的所有 `node-pty` 预构建均被排除。普通 Desktop 编译使用 `node scripts/verify-startup-policy.mjs --required-only` 检查生成后的启动代码；打包前使用不带该标志的命令继续检查生成后的运行时。两种形式都只输出一条 JSON 摘要。
