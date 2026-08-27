# Agent Note: 桌面端直接打开 Runtime 首页

Status: implemented

[English](2026-08-22-desktop-direct-runtime-home-startup.md) | 中文

## 问题

桌面冷启动输入页在真正 Web 产品出现前重复实现了主输入框、Agent Preset 选择和视觉标识，随后又被实际应用替换。支持这个临时页面需要三份本地资源、preload IPC bridge、sender 校验、进程内意图状态、重试行为，以及等待空白 Session 的浏览器交接。用户仍需等待 Runtime 才能真正使用产品，而且启动首屏并不是用户期望打开的目标页面。

先前的[可交互冷启动决策](../../archived/architecture/2026-08-20-desktop-interactive-cold-start.md)优化的是临时输入面的可见时间。当前产品验收要求首个可见窗口就是默认 Web 首页，不能出现启动页或中间白屏。

## 决策

Electron 就绪后，Main 以 `show: false` 创建沙箱化 `BrowserWindow`，随后启动完整受管 Runtime。只有当 Electron 将精确的 loopback 就绪 URL 解析为 direct-only 时才接受该地址；导航前注册 `ready-to-show`，再加载该 URL。只有导航和 Renderer 首帧都完成后才显示窗口。

首页导航期限为 30 秒。Runtime 启动、代理、导航、首帧或异常退出失败时，应用会停止所拥有的工作，只显示一次原生错误框并退出。它不会暴露空白窗口、恢复本地页面、保留草稿或提供窗口内重试入口。

删除启动 HTML、CSS、JavaScript、IPC handler、preload bridge、Client 启动意图消费者及其测试。由于 BrowserWindow 配置仍指向打包后的 preload 产物，保留空的沙箱 preload。启动策略的 `required` 类别只包含生成后的 Electron `.js` 与 `.cjs` 文件；受管 Runtime 在 BrowserWindow 创建后开始，仍作为一个粗粒度 deferred 单元。

## 曾考虑的替代方案

**保留本地输入页，但不交接草稿。** 不予采用：这仍会保留重复页面，而且首个可见页面仍与应用首页不同。

**`loadURL()` 完成后立即显示隐藏窗口。** 不予采用：Electron 可能在首帧渲染前完成导航，从而暴露白色中间窗口。

**直接加载静态 Web bundle。** 不予采用：受管 Host 拥有启动图、客户端 bundle 交付、HTTP 与 WebSocket API，以及权威默认路由。

## 影响

- 冷启动不再提供 Runtime 就绪前可编辑的输入面；用户在真实应用就绪后开始工作。
- 首个可见帧是默认 Web 首页。启动较慢时应用窗口保持隐藏，而不是显示临时 UI。
- 本次启动失败会明确报告并终止。修正原因后重新打开应用即可恢复。
- 细粒度 Host 惰性加载不在本决策范围内；完整受管 Runtime 仍作为一个单元启动。
