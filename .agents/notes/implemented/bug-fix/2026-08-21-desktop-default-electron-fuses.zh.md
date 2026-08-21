# Agent Note: Desktop packaging keeps Electron default fuses

Status: implemented

[English](2026-08-21-desktop-default-electron-fuses.md) | 中文

## 问题

打包后的桌面启动输入壳是 ASAR 所有的 HTML 文件，并通过 `BrowserWindow.loadFile()` 加载。关闭 `GrantFileProtocolExtraPrivileges` 的 Forge fuse 策略会让 Chromium 以 `ERR_FILE_NOT_FOUND` 拒绝这个真实存在的文件；Node `fs`、ASAR header 和每个逐文件完整性哈希仍能证明 `startup.html` 存在且可读。应用会在显示本地输入壳之前退出。

[可交互冷启动决策](../architecture/2026-08-20-desktop-interactive-cold-start.md) 拥有 ASAR 启动输入壳和 deferred Host Runtime。本 Agent Note 只拥有让 Chromium 能加载该输入壳的 fuse 策略。

## 决策

桌面 Forge 配置不注册 `FusesPlugin`，也不注册任何其他 fuse override。打包二进制保留 Electron 42.7.0 的默认 fuse 状态，包括 `GrantFileProtocolExtraPrivileges: true`，因此 `file:///.../app.asar/assets/startup.html` 通过 Electron 的常规路径加载。依赖 manifest 和 lock 不携带只服务 fuse 的包。

启动文档、preload 和 Host Runtime 的归属保持不变：输入壳仍在 ASAR 中，部署后的 Runtime 仍是物理的 `Resources/runtime` 目录，启动策略验证仍拒绝缺失的 required 文件、陈旧 Runtime 内容和非目标 `node-pty` prebuild。

## 考虑过的替代方案

- **保留 fuse 插件，只开启 `GrantFileProtocolExtraPrivileges`。** 这会在没有产品需求的情况下继续拥有一份 fuse 矩阵。Electron 默认 fuse 状态是启动输入壳的兼容性输入，不必要的 override 只会增加一个发布依赖和测试约定。
- **把启动输入壳移到 ASAR 之外。** 冷启动策略把输入壳归类为 required ASAR 内容。把它复制到 `Resources` 会产生第二个启动文件位置，同时不能改善 Host 必须留在 ASAR 之外的 Runtime 路径要求。
- **通过自定义协议加载输入壳。** 特权本地协议属于后续桌面 IPC 载体。只为抵消一个 fuse override 而引入它，会在产品需要该载体之前扩大主进程路由。

## 后果

安装后的应用会在 Host 就绪前打开本地启动输入壳，同时窗口保留现有的 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、导航限制和权限拒绝。后续 fuse 加固必须先替换启动文档的 `file` 加载路径，再证明打包应用可以启动。

## 测试

Forge 配置测试拒绝已注册的插件，并保持产品身份、图标、DMG maker、Runtime 和法律资源不变。带有旧 fuse 策略的打包 App 复现了 `ERR_FILE_NOT_FOUND`；同一个 App 只恢复 `GrantFileProtocolExtraPrivileges` 后成功加载 `startup.html`。打包应用启动仍是最终 DMG 的验收检查。
