# Agent Note：Aistaff Cloud 合规性确保生产环境输入显式化

[English](2026-08-15-aistaff-cloud-conformance-mainline.md) | 中文

状态：已实现

## 问题

本地 Aistaff 源码未发布客户端网关约定（Client Gateway contract）产物、经身份认证的客户端端点、可回放的员工投影（employee projection），亦未保留操作结果 API。其内部的 `Session`、`Run`、`Human Workbench` 和 `Deliverable` 类型均非渲染器（Renderer）约定类型。复用这些类型将使桌面端产品与服务内部实现强耦合，并可能导致报告出任何已发布端点均不支持的行为。

## 决策

宿主（Host）拥有一个 `CloudClientGatewayAdapter`，其不可变的约定产物、经身份认证的传输通道以及语义化的客户端问候（Client Hello）均为必需注入的输入项。生产环境组合（production composition）仅在协议选择成功且投影基线（projection baseline）完备后，才发布 `EmployeeExperiencePort`。若缺失必要输入或初始同步失败，则返回 `CLIENT_GATEWAY_UNAVAILABLE`；生产环境不提供测试前置数据（fixture）回退机制。

渲染器（Renderer）仅通过 `EmployeeExperiencePort` 消费完整的 `EmployeeExperienceSnapshot` 替换内容及不透明的品牌化引用。云游标（Cloud cursors）、选择租约（selection leases）、凭据（credentials）、传输头（transport headers）及恢复状态（recovery state）均保留在宿主中。所有变更操作均生成唯一操作标识（operation identity），并使用该同一标识协调不确定的操作结果。

在 Aistaff 正式发布生产级产物与端点之前，一个独立命名的合规性包（conformance package）提供固定根哈希（fixed-root-hash）的 `test_only` 产物及内存内传输通道。仅合规性组合包（conformance bundle）可加载该产物；生产组合包（production bundle）则明确排除合规性提供方（conformance provider）以及此前的产品测试前置数据（fixture）包。

云浏览器入口（Cloud browser entry）必须显式声明。DSH 默认的客户端模块发现机制不得在生产组合包或合规性组合包请求云 UI 时，错误选中测试前置数据（fixture）入口。

## 考虑过的替代方案

复用 Aistaff 内部 DTO 被否决，因其对应行为未由任何已发布的客户端端点所定义。

嵌入类生产的手写 Schema 被否决，因其将演变为第二份约定来源。

将现有测试前置数据（fixture）产品组合包作为回退机制加载被否决，因其会将本地测试状态误报为云环境状态。

## 影响

完整的浏览器流程与重连行为，均可通过同一适配器、Remote 层、对象层及 UI 进行验证——这些组件与生产环境所用完全一致。此验证体现的是合规性（conformance），而非真实 Aistaff 部署已就绪的证据。在提供固定版本产物、经身份认证的传输通道所有者以及身份配置之前，生产环境仍不可用；且上述变更不得影响渲染器产品的接口定义。
