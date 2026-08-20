# Agent Note：桌面端预发布环境包含语言策略运行时分片（chunk）

[English](2026-08-17-desktop-language-policy-runtime-chunk.md) | 中文

状态：已实现

## 问题

Aistaff 语言策略 Host 插件及其不变量（invariant）被分别编译为两个独立入口，二者通过内容哈希生成的 `lib/rules-*.js` 分片（chunk）共享 `rules.ts`。但包发布清单中仅包含这两个入口文件及其类型声明文件（`.d.ts`），未包含该分片。因此，桌面端运行时部署过程虽复制了 `lib/index.js`（其内部含相对路径的分片导入语句），却遗漏了实际被引用的分片文件，导致每次打包发布的 Voyaseek 应用均在就绪前启动失败，并报错 `ERR_MODULE_NOT_FOUND`。

## 决策

`@deepseek-ai/dsh-aistaff-language-policy` 包将 `lib/rules-*.js` 显式发布为包产物（artifact）。工作区（workspace）的包文件策略（package-file policy）同步将该额外条目纳入；同时，桌面端运行时验证流程（`verify:runtime`）要求存在一个物理上完全匹配的分片文件，并须在 Electron Forge 消费该目录前，先行导入已预发布的插件入口。

## 影响

- 打包后的 Host 插件与不变量（invariant）将解析并使用同一份编译后的规则实现。
- 若预发布的运行时分片（chunk）陈旧或不完整，则会在 `verify:runtime` 阶段即失败，而非生成一个在启动时才退出的 DMG（磁盘映像文件）安装包。
- 该分片（chunk）仍保持内容哈希机制；包发布与预发布流程均不锁定构建时生成的具体文件名。
