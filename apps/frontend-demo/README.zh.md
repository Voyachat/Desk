# AiDesktop 前端主流程 Demo

[English](README.md) | 中文

这是面向用户的 React 前端纵向切片，用于固化 AiDesktop 在 Voyaseek Harness Client 上的产品扩展方式。该 Demo 可独立运行，但不实现 agent、云任务、权限裁决或本地文件副作用。

## 运行

```bash
cd /Users/baron/projects/AiDesktop/apps/frontend-demo
pnpm install
pnpm run dev
```

在浏览器中打开 `http://127.0.0.1:4173/`。生产构建验证请执行：

```bash
pnpm run build
```

## 可操作主流程

1. 默认本地会话：支持对话交互、上下文与工具事件展示，底部提供 Composer 组件。
2. 新建会话：可选择 Workspace 或 Agent 预设，输入任务描述后创建本地会话。
3. AI 员工：通过侧边栏（Sidebar）插件区域进入，呈现云端下发任务在本地的投影。
4. 授权流程：当出现待授权请求时，`ApprovalComposer` 将接管 Composer 位置；用户完成一次拒绝或允许操作后，Composer 恢复为普通模式，并生成用户可见的回执。
5. 轨迹与详情切换：在同一会话头部可切换对话视图与轨迹视图；点击工具调用或回执项，将在右侧展开 Details 面板。
6. 设置与布局控制：支持设置模态框、折叠侧边栏（Sidebar）、配置权限及模型锚定菜单。

## 正式 Client 迁移边界

| Demo 边界 | 正式 DSH Client 位置 | 迁移方式 |
| --- | --- | --- |
| `features/shell/AppFrame` | `root` + `sidebar/conversation/details` slot | 首阶段直接复用上游 `ui-layout`，不迁移自有壳层实现 |
| `features/sidebar/Sidebar` 的 AI 员工区 | `sidebar.workspaces` 或独立 additive sidebar slot | 仅迁移 Employee/Inbox 行级组件；DSH Sidebar 的 chrome 部分保持上游实现 |
| `features/conversation/ConversationHeader` | `conversation.session.header.actions/utilities` | 迁移 Employee/Run 状态项，不替换标题区域与 Tab 导航结构 |
| `features/conversation/Transcript` 的产品事件 | `conversation.chat.node` / command/tool row slot | 为 Run、Decision、Receipt 事件分别注册独立渲染器 |
| `features/approval/ApprovalComposer` | `conversation.composer` 链 | 使用 selector 仅接管匹配的 Decision/Grant 请求；每个请求对应唯一 key，每次响应仅触发一次接管 |
| `features/trajectory/TrajectoryView` 的产品行 | 上游 `conversation.view` 轨迹投影 | 扩展 CLOUD/DECISION/RECEIPT 事件定义，不 Fork 整个轨迹页面 |
| `features/details/DetailsPanel` 内容 | `conversation.details.tool` 或 keyed tool view | 迁移 Run/Grant/Receipt 的详情内容，复用上游抽屉组件与尺寸调节能力 |
| `features/settings/SettingsDialog` 内容 | settings section slot | 仅注册账号、设备授权、AI 员工等 Section，复用上游 Settings chrome |

## 状态与适配规则

- [`src/client/client-port.ts`](src/client/client-port.ts) 是前端 Host seam；正式版本中需将其动作替换为类型化 RPC 调用，并将状态读取逻辑替换为对接 DSH session/workspace store 与 Aistaff 投影。
- [`src/client/demo-client.ts`](src/client/demo-client.ts) 仅用于保存可序列化的 fixture 数据及 `localStorage` 演示状态，禁止迁入正式 Runtime。
- [`src/domain/client-state.ts`](src/domain/client-state.ts) 仅为页面所需最小状态投影，既非云协议权威，亦非权限决策权威。正式 DTO 应由各领域 Owner 显式映射生成，不得复制第二套 Run/Decision Schema。
- `features/**` 下所有组件仅通过 props 接收状态与动作；迁入插件时须严格遵循该规则，由插件入口点注入 DSH hooks/store/actions。
- Demo 中“已创建文件”等文案明确标注其未实际写入磁盘；真实副作用（如文件写入、网络调用等）只能由 Supervisor/Runtime 执行，并返回结构化回执。

## 参考

- [总体构建方案](../../Doc/构建方案.md)
- `/Users/baron/projects/DsAgent/packages/client/AGENTS.md`
- `/Users/baron/projects/DsAgent/docs/web-styling.md`
