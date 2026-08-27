# Agent Note: Voyaseek 0.2 对比构建身份

Status: implemented

[English](2026-08-21-voyaseek-02-comparison-build-identity.md) | 中文

## 问题

稳定版 0.1.x Voyaseek DMG 仍是线上安装版本。DSH rc.8 升级必须作为独立的 DMG 交付，能够与稳定版同时安装、同时运行，让评审者在不卸载稳定版的情况下对比行为，并且两个构建互不读取对方的设置、会话或 Runtime 状态。

## 决策

rc.8 分支把桌面应用打包为 `Voyaseek 0.2` 对比构建。应用名、可执行文件和 DMG 文件都使用 `Voyaseek 0.2` 名称，Bundle Identifier 为 `ai.voyaseek.desktop.v02`，`CFBundleShortVersionString` 为 `0.2`，`CFBundleVersion` 记录底层的 `0.1.0-rc.8` 包版本。由于应用名不同，Electron 会把 userData 解析到独立的 `~/Library/Application Support/Voyaseek 0.2` 目录；独立的 Bundle Identifier 也让 Launch Services、Dock 和单实例锁按构建各自隔离。workspace 包版本保持 `0.1.0-rc.8`，使其余 workspace 引用继续跟随上游预发布版本；只有打包后的元数据呈现 `0.2`。

## 影响

两个构建可以同时安装在 `/Applications` 下并同时运行，各自拥有独立的 profile、模型凭据输入、workspace 和会话数据库。稳定分支保持 `Voyaseek` 身份和 `ai.voyaseek.desktop` Bundle Identifier 不变。当 0.2 线结束对比阶段时，稳定分支采用这套身份，各版本字段再一起推进。

## 已否决的替代方案

在主进程中覆盖 `app.setPath('userData', ...)` 被否决，因为在 macOS 上不同的应用名已经隔离了 userData，路径覆盖只是重复平台默认行为而没有增加保证。把 workspace 包版本改为 `0.2.0` 被否决，因为 workspace 引用和上游同步工具都以 DSH 预发布版本为键。
