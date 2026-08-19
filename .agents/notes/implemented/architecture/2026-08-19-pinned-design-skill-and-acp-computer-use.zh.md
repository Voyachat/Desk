# Agent Note：固定版本设计指引与电脑操作保留在插件边界

状态：已实现

[English](2026-08-19-pinned-design-skill-and-acp-computer-use.md) | 中文

## 问题

网页设计任务需要可重复的视觉方法，桌面自动化则需要访问原生辅助功能与屏幕捕获设施。在 DSH 内重写任一能力，都会重复建设 Skill loader、agent loop、原生 helper 及其升级负担。把已审核的上游运行时导入主进程，也会为每个员工 profile 扩大可信依赖和权限面。

## 决策

base bundle 交付 `leonxlnx/taste-skill` 提交 `dfb6f9f9e93a39f673b1827c0889cc28326d1800` 中 MIT 许可的 `design-taste-frontend` Skill 原文。现有 `skill-filesystem` provider 从已安装的 `@voyaseek-ai/dsh-base` 包解析 bundle 自有 `skills` 目录。现有 `tool-skill` consumer 上部署方可信的双语 include/exclude 规则，会为直接的落地页、营销页、作品集、网页设计和视觉重设计请求自动注入正文。持久调用来源记录 `trigger: automatic`；注入文本和工具输出不能触发规则。显式 slash 调用与模型可见目录继续作为兜底路径。这里不增加新的 Skill provider 或设计 Agent 运行时。

桌面自动化保持为自动感知可用性的外部能力。宿主加载时，`dsh-subagent-acp` 会要求现有 subprocess provider 解析受管的 Prime Agent `v0.7.3` 可执行文件。探测成功就注册 `prime-computer-use`；探测失败则不注册，随生命周期绑定的 `computer_use` 工具也保持缺席。标准模式、PTC 模式与 Cordis 模式贡献这个任务专属工具，不需要用户开关。调用会启动新的 ACP 子进程并加载 `@injaneity/pi-computer-use@0.5.0`。DSH 不导入 Prime Agent、Pi 扩展 API、原生 helper 或安装器。子进程移除 Prime 内置工具，只在 headless 模式启用 Pi 的状态化桌面操作，并关闭浏览器控制和光标覆盖。

Skill 源码、两个外部依赖决策、已审核上游版本、本地路径和升级策略登记在 `.open-source/adoptions.yaml`。这项能力不需要修改 agent loop 或 session format。

## 结果

- 前端设计指引开箱可用且没有第二条加载路径；部署方可信任务规则会在模型行动前注入，显式调用与模型选择继续作为兜底。
- computer-use 进程可以独立于 DSH 安装、升级、禁用、审计或替换。
- ACP 子进程只接收委派任务并返回最终 assistant 文本；详细会话和工具轨迹仍由 Prime Agent 持有。
- 自动 computer-use 注册不是生产安全边界。签名 helper、应用／窗口 allowlist、协议认证与帧大小限制、截图留存策略、DLP 和效果审批仍是部署前置条件。

## 已考虑的替代方案

没有把 Prime Agent 的 loop 或 Pi 的原生实现复制到 DSH，因为 DSH 已经拥有 agent、session、subprocess、permission 和 subagent 能力。没有导入 VoltAgent，因为它的 workflow、agent、provider 与 telemetry 运行时会重复现有 DSH seam。没有采用 OpenCut，因为其当前重写版本尚未提供稳定的 editor、plugin、MCP 或 headless API。TencentDB Agent Memory 保留为未来的原生 memory provider，而不是 proxy 集成，因为其当前 gateway 默认值、身份隔离、删除授权和写入幂等性不满足员工 Agent 的发布要求。如果未来需要协作产品面，Buzz 应作为外部 ACP 协作产品，而不是个人 Agent 的源码依赖。
