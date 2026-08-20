# Agent Note: 桌面端预发布环境包含语言策略运行时分片

Status: implemented

[English](2026-08-17-desktop-language-policy-runtime-chunk.md) | 中文

## 问题

Aistaff 语言策略 Host 插件及其 invariant 被分别编译为两个独立入口，二者通过内容哈希生成的 `lib/rules-*.js` 分片共享 `rules.ts`。但包发布清单中仅包含这两个入口文件及其声明文件，未包含该分片。因此，桌面端运行时部署过程虽复制了 `lib/index.js` 及其相对分片导入，却遗漏了实际被引用的文件，导致每次打包发布的 Voyaseek 应用均在就绪前启动失败，并报错 `ERR_MODULE_NOT_FOUND`。

## 决策

`@deepseek-ai/dsh-aistaff-language-policy` 包将 `lib/rules-*.js` 显式发布为包产物。工作区的包文件策略同步纳入该额外条目；同时，桌面端运行时验证流程要求存在一个物理上匹配的分片文件，并在 Electron Forge 使用该目录前导入已预发布的插件入口。

## 考虑过的替代方案

**仅发布入口文件与声明文件。** 这正是原先不完整的产物集合：`lib/index.js` 保留相对导入，但被引用的运行时分片并不存在。

**固定一个构建专属的分片文件名。** 分片使用内容哈希，因此包发布与预发布规则匹配产物模式，而不是编码一个会随编译内容变化的文件名。

## 影响

- 打包后的 Host 插件与 invariant 解析并使用同一份编译后的规则实现。
- 若预发布的运行时分片陈旧或不完整，则会在 `verify:runtime` 阶段失败，而非生成一个在启动时退出的 DMG。
- 该分片仍保持内容哈希机制；包发布与预发布流程均不锁定构建时生成的具体文件名。
