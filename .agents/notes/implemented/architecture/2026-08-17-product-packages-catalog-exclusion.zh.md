# Agent Note：产品包不纳入智能体框架 Cordis 目录

[English](2026-08-17-product-packages-catalog-exclusion.md) | 中文

状态：已实现

## 问题

AiStaff 产品导入引入了十一个 `packages/aistaff/*` 包，将十二个 `ctx.*` 服务合并至 Cordis 上下文（Context）中，涵盖员工体验、本地能力、主管管控与流程、产品投射、云合规性与提供方、远程网关，以及仅用于测试的合规性控制。由 Typert 支持的 Cordis 目录采用双向“失败即关闭”（fail-close）策略：所有被发现的服务均需具备 `SERVICE_PAGE` 分区；所有签名类型均需配备文档链接。若将产品接口面归类至智能体框架文档目录中，则会发布那些公共智能体框架文档并不拥有所有权的产品 API，并在每次产品变更时重新生成这些产物。

## 决策

`CordisCatalogPolicy.excludedPackages` 指定被排除在投影之外的 manifest 包。`projectCordisCatalog` 对语义分析与导出声明索引应用同一组经过过滤的包集合，因此被排除的服务、事件、签名链接及运行时类型声明均无法影响所生成的智能体框架产物。[仓库策略](../../../../scripts/gen-cordis-catalog.ts) 列出了这十一个产品包，并在 `SERVICE_WALK_EXEMPTIONS` 中逐一注明其对应的十二个上下文键；独立的声明扫描仍会读取每一次上下文合并操作，因此对于已声明但未渲染的键，该扫描机制仍保持“失败即关闭”策略。`AgentDriverFactory` 是智能体框架自有（harness-owned）的 agent 驱动器类型，其链接指向 [核心子系统页面](../../../../docs/subsystems/core.md)。

## 影响

- 智能体框架目录仅记录智能体框架自身的 API；产品服务 API 保留在其所属包的 README 文件中，路径为 [`packages/aistaff`](../../../../packages/aistaff)。
- 若某产品包暴露了 Cordis 接口面，则必须为其添加排除条目；且每个被排除的上下文键均须配置一项遍历豁免（walk exemption），并明确指定其文档责任人。智能体框架自身服务仍需配置页面分区，并为其签名类型提供文档链接。
- 目录约定套件（catalog contract suites）正常执行而非跳过，其中包含一项 fixture，用以验证：被排除的包及其同名导出类型既无法进入运行时目录，也无法抑制其注册。
- `ConformanceClock.now` 和 `ConformanceDirectorySelector.calls` 上标注的检查模式（check-mode）分析器必需注解，仍作为显式的源码类型保留。
