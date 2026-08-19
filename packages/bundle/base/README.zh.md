# `@voyaseek-ai/dsh-base`

[English](README.md) | 中文

以 profile 组合包形式交付的共享 dsh 核心：[`cordis.patch.yml`](cordis.patch.yml) 在空的 profile 根之上插入全部基础插件行——模型适配器、共享的 [`agent-default-model`](../../core/agent-default-model/README.md) 选择、工具、持久化、策略、settings／credentials、遥测与宿主级 subagent provider——作为每个 profile 的 `dsh.profile.bundles` 列表中的第一层。Codex 与 Claude Code provider 以休眠状态加载；Agent Preset 分别决定自己的 agent 是否贡献任一面向模型的委派工具。后续的组合包层（例如 [`dsh-web-app`](../web-app/README.md)）和用户 profile 的 `cordis.patch.yml` 按 id 覆盖这些行；patch 会替换目标行的整个 `config`，因此模式专属的值放在各模式组合包中，而不是这里。该包没有运行时 API；profile 组合器通过 manifest（元数据清单）的 `dsh.bundle.patch` 字段解析 patch，绝不通过代码。

patch 在自身上按平台门控两个 shell 栈：`bash-sandbox`/`tool-bash` 携带 `disabled: !!js process.platform === 'win32'`（bash 没有 Windows runner），它们的孪生行 `pwsh-sandbox`/`tool-pwsh` 以取反的表达式仅在 win32 挂载——同一份 patch 文件，每个宿主恰好挂载一个 shell 栈。权限面与 POSIX 完全一致：`sandbox`/`sandbox-policy` 通过 Windows ACL 受限令牌 runner（`dsh-sandbox-local` 的 win32 链 → `@voyaseek-ai/dsh-sandbox-windows-acl`）执行文件效果策略，权限切换器与 approval 服务原样运行，`fs-sandbox` 继续围栏 `ctx.fs` 写入——在其旁再挂载 `dsh-fs-local` 会重复注册 `ctx.fs` 并在加载时失败。偏好不受沙盒约束的本地 pwsh 执行器或完整访问的 Windows 主机通过其 profile 或 home 的 `cordis.patch.yml` 覆盖这些行（bash 恢复配方必须完整：禁用 `pwsh-sandbox`/`tool-pwsh` 并重新启用 `bash-sandbox`/`tool-bash`——两个执行器家族注册同一个 `bash` 服务，配方不完整会在加载时直接报错）。POSIX 主机看到的是被禁用的 pwsh 行。

行集合及其设计依据以行内注释写在 patch 文件里；[生成的组合图](../../../apps/cli/composition.md)负责渲染它。

Base 还会启用有界本地 [`ctx.agentMemory`](../../memory/README.md) Provider，以及采集已完成轮次、在第一步召回的 Consumer。该能力无需外部服务或凭据，并可在 Provider 中立服务后替换。

## 内置设计 Skill

每个 profile 都通过现有 filesystem skill provider 暴露固定版本的 [`design-taste-frontend`](skills/design-taste-frontend/SKILL.md) Skill。它逐字采用 MIT 许可的 `leonxlnx/taste-skill` 提交 `dfb6f9f9e93a39f673b1827c0889cc28326d1800`；相邻 LICENSE 与[开源采用登记](../../../.open-source/adoptions.yaml)保留其来源。这里不增加第二套 Skill loader 或设计 Agent 运行时。

该 Skill 适用于 landing page、作品集、营销页面和视觉重设计，并明确排除 dashboard 与信息密集型产品界面。部署方可信的双语任务规则会在直接用户文本匹配网页设计意图时自动注入完整正文；排除规则会过滤 dashboard、管理后台、数据表格、多步骤表单、编辑器、原生移动端与实时协作。slash 手势和模型可见目录继续作为兜底路径。确定性视觉验收仍由独立 workflow 负责。

同一个 bundle 会探测单独受管的 `prime-agent` 可执行文件，但不会启动它。存在时，宿主注册 `prime-computer-use` ACP provider，标准模式、PTC 模式与 Cordis 模式暴露 `computer_use`；不存在时，两者都不会进入模型工具视图。只有模型选择这个任务专属工具后才会启动子进程。

## 模型体验

通过插入的行间接产生影响：该组合包选定了随发行版交付的无 persona 提示词基座、工具集合与 DeepSeek 适配器，供各模式组合包进一步特化。它还贡献稳定的 `design-taste-frontend` 目录项；Skill 正文只在被选择后对模型可见。

#### KV Cache 影响

稳定的 Skill 目录项会影响初始提示词。加载 Skill 正文会形成任务级上下文变化；其他插入行的影响由其所属包负责。

## 已知限制与暂缓事项

- **patch 会替换整行 `config`**：profile 覆盖必须重述该行需要保留的每个字段；不存在深度合并层。
- **Claude SDK 的平台 CLI（命令行界面）仍在 Profile 安装闭包中**：base 组合包依赖 Claude 提供方，其生产路径解析宿主提供的 `claude`；移除 SDK 中未使用的可选载荷，推迟到产品安装闭包后续项处理。
- **Windows 的临时目录授权是按会话的私有子目录**——`workspace-write` 把写入限制在工作区与会话自己的 temp 子目录（`<temp>\dsh-<hash>`，受限子进程的 TMP/TEMP 被改写）；`read-only` 不授予任何临时目录写入权限。见 `@voyaseek-ai/dsh-sandbox-windows-acl`。
