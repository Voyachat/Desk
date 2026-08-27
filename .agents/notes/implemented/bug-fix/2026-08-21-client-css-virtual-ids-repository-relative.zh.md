# Agent Note: 仓库相对路径的 client CSS 虚拟模块 id

Status: implemented

[English](2026-08-21-client-css-virtual-ids-repository-relative.md) | 中文

## 问题

`dsh-css-text-inline` 与 `dsh-css-global-inline` 两个 loader 用样式表的绝对路径构造虚拟模块 id。Rolldown 会把每个模块 id 打进 bundle 的 `//#region` 注释，因此每个打包出的 `lib/client.js` 都嵌入了构建机的仓库路径，桌面 Runtime staging 门禁（`rejectDevelopmentPaths`）会拒绝该产物。

## 决策

`packages/client/tsdown.client.ts` 中的三个 CSS 虚拟 loader 现在共用同一条注册路径：虚拟 id 使用 `repositoryAssetId(abs)`，即仓库内相对、正斜杠形式的样式表路径；每个配置内以虚拟 id 为键的映射在 load 钩子里还原出物理文件。这正是 CSS Modules loader 已有的机制，两个新 loader 现在与它保持一致，包括同样的冲突检查和样式表必须位于仓库内的要求。

## 影响

无论仓库克隆到哪个目录，构建出的 client bundle 字节完全一致，Runtime staging 在任意机器上都能通过。位于仓库根目录之外的样式表会在 resolve 阶段直接失败，而不会把宿主机路径带进交付产物。

## 已否决的替代方案

从输出中剥离 region 注释被否决，因为注释是 Rolldown 用于调试的模块映射，而且其他消费 id 的输出仍然泄漏路径。保留绝对 id、只在生成注释时相对化也被否决，因为虚拟 id 同时是模块去重键；两个不同根目录为同一文件生成不同 id 时会静默重复打包模块。
