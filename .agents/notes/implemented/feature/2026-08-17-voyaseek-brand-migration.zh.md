# Agent Note：Voyaseek 品牌迁移保持生态标识符不变

[English](2026-08-17-voyaseek-brand-migration.md) | 中文

状态：已实现

## 问题

桌面客户端以 Voyaseek 品牌面向外部客户发布，但所有客户可见界面都带有上游身份：窗口和文档标题、PWA manifest、favicon、侧边栏文字标识、主视觉标识、首次运行提示、Electron 应用与 DMG 名称、错误对话框，以及模型可见的系统提示词。简单全局重命名“DeepSeek”还会改写第三方 DSH 插件依赖的标识符，包括 `@deepseek-ai/*` 包名、`DSH_HOME` 布局、`__DSH_BOOT__`、`dsh` CLI 和会话日志事件名，从而破坏插件解析和持久化。另一方面，MIT 要求再分发产物携带上游版权与许可文本，但不要求产品 UI 保留上游品牌。

## 决策

产品身份与兼容性标识符按层分开。客户可见界面统一改为 Voyaseek：Web shell 标题、manifest 和 favicon；`BrandWordmark` 与 `FishLogo`（保留导出名，图案替换为 Web shell 提供的主题栅格资源）；固定中英组合、中文在上的主视觉标语；提高版本以要求所有用户重新确认的首次运行欢迎文案；Electron `name`、`executableName`、错误对话框、用于打开内置法律文本的 Help 菜单；以及 `appBundleId`（`ai.voyaseek.desktop`）。兼容性标识符保持字节不变。

Agent 身份只在部署层变更，不修改 DSH 核心包。aistaff product-bundle patch 设置 `includeHarnessIdentity: false`，并在 `system-prompt` 上配置 Voyaseek persona；同时禁用 `web-runtime.surfaceContext`，因为上游 Web 界面说明会提到上游产品并面向 Harness 开发者；`printUrl` 保持开启，用于 Electron 就绪提示。发布的 `standard`、`code` 和 `cordis` preset persona 都以 Voyaseek 身份开始；`dsh-persona` preset 段复写部署 persona，使两条路径呈现相同品牌。核心包保持不变，便于上游合并并保持第三方插件预期。

MIT 归属信息随分发产物提供，而不嵌入 UI：Forge `extraResource` 打包 `legal/USER_AGREEMENT.zh-CN.md`（DSH 只出现在开源章节）、`legal/third-party/deepseek-harness/LICENSE`（协议通过相对路径引用的根 MIT 文本逐字副本），以及现有 `THIRD_PARTY_NOTICES.md`。

## 已考虑的替代方案

我们否决了重命名 `@deepseek-ai` scope 或 `DSH_HOME`，因为第三方插件通过这些标识符解析包并持久化状态。我们否决了在核心包内修改 harness 身份句子或 Web 界面提示词，因为部署配置已经能实现相同行为，而分叉核心文本会增加每次上游合并的成本。我们也否决了在任何主题中保留 DeepSeek 标语或文字标识，因为它们是 GUI 中最明显的上游品牌标识。

## 影响

打包客户端从头到尾呈现 Voyaseek 品牌，而任何 `dsh-plugin` 主题插件都可以不经修改地安装和运行。bundle id 变化会重置 macOS 上既有内部安装的应用数据，预发布分发接受这一影响。作为功能数据的厂商名称仍保留，例如模型设置中的 DeepSeek 提供方、DashScope 和 Google。打包客户端之外面向开发者的界面（仓库文档、演示 fixture、`dsh` CLI 帮助）仍按设计使用上游项目名称。
