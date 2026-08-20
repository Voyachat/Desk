# Agent Note：开源升级使用包外项目工作流

[English](2026-08-20-out-of-package-open-source-upgrade-workflows.md) | 中文

状态：已实现

## 问题

AiDesktop 采用 DSH 源码基础、vendored Cordis 包、已发布依赖、复制的源码块和架构参考。采用账本记录来源与当前范围，而 DSH/Cordis 更新规则、Voyaseek 包重定界、产品品牌转换、验证和桌面打包分别由不同 owner 负责。仅靠记忆重建顺序会拖慢上游刷新，还可能在现有插件或部署扩展能够保持产品行为时错误修改基础代码。把新升级器嵌入运行时包也会让产品依赖本地开源代码 checkout 和仅用于维护的代码。

## 决策

标准库工具及其规格位于 `/Users/baron/projects/开源代码/adopt-open-source`，不属于任何 AiDesktop 工作区或发布系列。AiDesktop 在 `.open-source/adoptions.yaml` 保存来源，并在 `.open-source/plugins/*.json` 保存声明式项目工作流。插件标识现有采用记录、列出必须排除在产品产物之外的路径，并为 `inspect`、`sync`、`adapt`、`brand`、`verify`、`record` 和 `package` 步骤排序。命令使用带有有界占位符的参数数组，人工步骤携带当前说明。工具验证并渲染这些步骤，但绝不执行。

插件还可以声明分析区域，把上游路径前缀关联到当前本地 seam、初始 `adopt`、`adapt`、`defer`、`reject` 或 `review` 策略、架构原因和验证项。`analyze-upgrade` 验证 checkout origin 和线性提交范围，把每个变更文件分配给最长匹配前缀，并报告文件状态计数、相关提交、本地路径是否存在及未匹配变更。这些规则用于整理证据；它们不替代源码与测试评审，也不会把声明的策略变成最终采用决定。

DSH 工作流把采用账本作为 DSH 源码基线的 owner，把 `vendor/README.md` 作为 Cordis 版本和本地差异的 owner，把 `scripts/rescope-vendor.ts` 作为 vendored 包名转换的 owner，并把 `scripts/rebrand.ts` 作为产品品牌转换的 owner。只要现有包、Cordis 插件、preset 和应用组装能保持产品行为，就继续由这些扩展点承载。替换基线之前必须完成验证。Git 历史记录迭代，因此账本为每项采用只保留一条当前记录，不累积变更日志副本。

打包仍是显式授权边界。工作流可以用 `requires_approval: true` 渲染现有 DMG 命令，但不会执行打包、发布、网络写入、Git 写入或产物上传。`.open-source`、`.agents` 和维护 codemod 保持在 npm 发布系列、暂存运行时依赖闭包和 Forge extra resources 之外；法律归属与生成的第三方声明继续通过现有产品 owner 发布。

## 已考虑的替代方案

我们否决了 DSH 运行时插件，因为来源评审和源码同步是维护操作，不是模型或产品能力。我们否决了自由格式 Python 插件 API，因为仅检查陌生业务仓库就可能执行仓库代码。我们否决了第二套品牌或 vendoring 实现，因为它会造成可执行 owner 重复和漂移。我们也否决了自动合并、补丁重放、ref 替换和打包，因为源码来源、许可证变化、本地工作和产物创建都需要评审或新授权。

## 影响

上游评审拥有机器可读、项目专属的分析映射和执行顺序，不会产生运行时依赖。其他业务项目可以基于同一个外部工具定义自己的 JSON 规则，同时保留各自现有的 codemod、测试和打包命令。未匹配的上游变更保持可见，不会被强行归入无关能力。缺少 checkout 或目标值时，继续显示为计划输入，而不是触发部分命令。错误 origin、分叉目标、未登记 adoption ID、路径遍历、不支持的占位符或未知插件字段都会导致验证失败。

采用账本把 DSH 源码固定到精确的上游 Git 提交。恢复证据将导入的 AiDesktop 提交与已发布的 `0.1.0-rc.5` tree 对比：5,299 条共享路径中有 5,177 个 Git blob 字节完全相同，产品新增内容和导入时适配仍是本地差异。因此 `upgrade-plan` 和 `analyze-upgrade` 可以把账本 ref 直接作为可解析基线，无需重写或删除这些本地变更。
