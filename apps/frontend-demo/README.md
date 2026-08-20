# AiDesktop 前端主流程 Demo

English | [中文](README.zh.md)

这是用户可见的 React 前端纵向切片，用于冻结 AiDesktop 在 Voyaseek Harness Client 上的产品扩展方式。它可以独立运行，但不实现 Agent、云任务、权限裁决或本地文件副作用。

## 运行

```bash
cd /Users/baron/projects/AiDesktop/apps/frontend-demo
pnpm install
pnpm run dev
```

打开 `http://127.0.0.1:4173/`。生产构建检查使用：

```bash
pnpm run build
```

## 可操作主流程

1. 默认本地会话：对话、上下文与工具事件、底部 Composer。
2. 新会话：选择 Workspace/Agent preset，输入任务并创建本地会话。
3. AI 员工：从 Sidebar 插件区进入云端下发任务的本地投影。
4. 授权：待授权时 `ApprovalComposer` 接管 Composer seat；拒绝或允许一次后恢复普通 Composer，并产生用户可见回执。
5. 轨迹与详情：在同一会话头切换对话/轨迹；工具或回执打开右侧 Details。
6. 设置与布局：设置模态框、Sidebar 折叠、权限和模型锚定菜单。

## 正式 Client 迁移边界

| Demo 边界 | 正式 DSH Client 位置 | 迁移方式 |
| --- | --- | --- |
| `features/shell/AppFrame` | `root` + `sidebar/conversation/details` slots | 首阶段直接使用上游 `ui-layout`，不迁入自有壳 |
| `features/sidebar/Sidebar` 的 AI 员工区 | `sidebar.workspaces` 或独立 additive sidebar slot | 只迁入 Employee/Inbox 行组件；DSH Sidebar chrome 保持上游实现 |
| `features/conversation/ConversationHeader` | `conversation.session.header.actions/utilities` | 迁入 Employee/Run 状态项，不替换标题与 Tab |
| `features/conversation/Transcript` 的产品事件 | `conversation.chat.node` / command/tool row seats | 为 Run、Decision、Receipt 注册独立 renderer |
| `features/approval/ApprovalComposer` | `conversation.composer` chain | 用 selector 只接管匹配的 Decision/Grant；一请求一 key、一回答一次 |
| `features/trajectory/TrajectoryView` 的产品行 | 上游 `conversation.view` 轨迹投影 | 扩展 CLOUD/DECISION/RECEIPT 事件定义，不 Fork 整个轨迹页面 |
| `features/details/DetailsPanel` 内容 | `conversation.details.tool` 或 keyed tool view | 迁移 Run/Grant/Receipt 详情内容，复用上游抽屉和 resize |
| `features/settings/SettingsDialog` 内容 | settings section slots | 只注册账号、设备授权、AI 员工 Section，复用上游 Settings chrome |

## 状态与适配规则

- [`src/client/client-port.ts`](src/client/client-port.ts) 是前端 Host seam；正式版本将其动作替换为类型化 RPC，并把读取替换为 DSH session/workspace store 与 Aistaff projection。
- [`src/client/demo-client.ts`](src/client/demo-client.ts) 只保存可序列化 Fixture 和 `localStorage` 演示状态，不得迁入正式 Runtime。
- [`src/domain/client-state.ts`](src/domain/client-state.ts) 是页面所需最小投影，不是云协议或权限权威。正式 DTO 应由各 Owner 映射，不复制第二套 Run/Decision Schema。
- `features/**` 组件只通过 props 接收状态和动作；迁入插件时保持该规则，由插件入口注入 DSH hooks/store/actions。
- Demo 中“已创建文件”等文案明确标注未实际写入；真实副作用只能由 Supervisor/Runtime 执行并返回回执。

## 参考

- [总体构建方案](../../Doc/构建方案.md)
- `/Users/baron/projects/DsAgent/packages/client/AGENTS.md`
- `/Users/baron/projects/DsAgent/docs/web-styling.md`
