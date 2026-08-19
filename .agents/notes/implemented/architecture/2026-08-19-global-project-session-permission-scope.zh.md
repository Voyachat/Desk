# Agent Note：权限默认值采用受信任的全局与项目作用域

Status: implemented

[English](2026-08-19-global-project-session-permission-scope.md) | 中文

## 问题

权限预设原本已有两个不同生命周期：后续新会话的全局默认值，以及当前会话的持久事件。桌面界面只暴露全局值，因此用户无法让一个项目保持保守权限，同时让其他项目使用另一默认值。把覆盖值存进仓库文件并不安全：不受信任的代码仓可以为自己提交完全访问权限，而 `AGENTS.md` 与 `CLAUDE.md` 是模型指令，不是 host 强制执行的授权。

权限标签还直接渲染 host 的英文名称，绕过了客户端 locale，尽管本机与 Claude 会话共用同一组浏览器界面。Claude 也只区分完全访问与其他所有受限预设，因此三种产品模式没有产生三种 SDK 权限姿态。

## 决策

受信任的用户 settings 文档在同一个 namespace 中拥有两类默认值：

```yaml
permission:
  defaultPreset: workspace-write
  workspacePresets:
    /canonical/absolute/project: read-only
```

`workspacePresets` 的 key 是规范绝对路径，值必须来自已配置的 preset 表。新建且没有 seed 的会话先解析规范 cwd 的精确项目覆盖，再解析全局默认值，然后把 `permission/preset`、`sandbox/mode` 与 `approval/policy` 固定进日志。Seeded、恢复、forked 以及已经固定权限的会话保留其持久事实。删除或移动项目不会扩大权限：未命中的路径回退到全局默认值；在同一个规范目录重新创建项目则有意复用用户拥有的规则。

浏览器 Settings 设置块通过带 revision 的 Settings 操作写入全局值或当前 Workspace 路径。清除项目覆盖使用 `unset`，恢复对全局值的继承。Composer 与 `/permission` 选择器仍控制当前会话。所有作用域选择完全访问权限前都必须显式确认。

内置 preset 机器值保持稳定，客户端在使用时渲染本地化产品文案：`read-only` 是「请求批准」，`workspace-write` 是「帮我批准」，`danger-full-access` 是「完全访问权限」。自定义 preset 名称与说明仍回退到 host 文案。斜杠命令协议名也保持稳定；命令菜单使用单独的本地化展示标签。

本机与 Claude 会话读取相同的持久权限事实。没有显式部署覆盖时，Claude 将 `read-only` 映射为 SDK `default`，并将 `workspace-write + ask` 映射为 SDK 基于分类器的 `auto` 审查。`danger-full-access + never` 保留 SDK `default`，使 `AskUserQuestion` 能到达 host 问题服务，同时 DSH bridge 直接放行所有非提问工具。这对齐的是交互意图，不是强制执行实现：Claude SDK 模式不声称具有与本机沙箱相同的操作系统隔离强度。权限预设控制文件效果与审批行为；浏览器和网络限制仍是独立能力。

`AskUserQuestion` 与权限提示共用 SDK `canUseTool` 传输，但由不同能力拥有：问题使用 `ctx.userQuestions`，权限提示使用 `ctx.approval`。通用记住操作只接受整批均为同一工具、session 目的地、allow-rule 新增的 SDK 建议。存活的 Claude driver 会把这些规则带到后续 query 子进程；混合批次、settings 文件目的地、模式或目录变更，以及其他工具的规则都会被拒绝。这种授权只是存活 driver 的内存便利功能，不是持久 DSH preset，也不能修改 Claude 的用户、项目或本机 settings。

## 后果

- 优先级是当前会话持久事实、后续新会话的项目默认值、全局默认值，以及 Settings 尚未挂载时的部署组合默认值。
- 仓库内容可以指导模型，但不能授予执行权限。Host 从不把项目指令当作授权读取。
- 修改默认值不能静默扩大已有或回放会话的权限。
- 一个项目规则适用于以相同规范 cwd 创建的本机、Claude、CLI 及其他会话。
- 显式配置的 Claude `permissionMode` 仍覆盖自动映射，并由部署方负责。
- 显式 `bypassPermissions` 部署覆盖无法呈现 `AskUserQuestion`，因为 SDK 会在该模式下先于回调解析工具。
- 在产品能够承诺 ChatGPT 式网络控制前，需要另建浏览器或网络 allowlist 强制执行能力。

## 考虑过的替代方案

把 SDK 建议持久化到 Claude 用户或项目 settings 的方案被否决，因为通用审批操作无法展示其目的地，并会绕过 DSH 拥有的设置优先级。把内置完全访问 preset 映射为 SDK `bypassPermissions` 的方案被否决，因为该模式会在 host 回调之前吞掉 `AskUserQuestion`。持久浏览器规则事件推迟到 DSH 拥有显式的规则、作用域、回放与撤销接口之后；当前存活 driver 缓存保持仅会话有效，且以重启为边界。
