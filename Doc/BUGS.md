# AiDesktop 用户反馈与缺陷台账

> 本文只记录用户可见问题、当前证据、验收结果和下一入口。架构/API/数据事实仍由对应 owner 文档维护；实现与真实验收优先于本文状态。

## 当前优先级

| ID | 用户可见问题 | 状态 | 验收标准 |
| --- | --- | --- | --- |
| BUG-001 | macOS 持续弹出“找不到用于储存 `@deepseek-ai/dsh-aistaff-desktop Key` 的钥匙串” | 已验收 | 正常 Keychain 配置与全新用户数据下启动、刷新、连续使用均不弹框；不把模型 Key、Cloud token 或 Cookie 改存明文 |
| BUG-002 | 对话消息下方“复制”按钮点击后没有复制内容 | 已验收 | 用户与助手消息均能复制精确可见正文；成功/失败有可访问反馈，失败不伪装成功 |
| BUG-003 | 选择 `danger-full-access` 后审批策略随之成为 `never`，需要授权的操作被 Auto-Reject | 已验收 | AI Staff 的客户交互预设允许真实 Approval 请求到达现有 DSH 审批 UI；`never` 只在明确的无人值守配置中使用，不能随可交互预设静默启用 |
| BUG-004 | 模型调用失败时，页面把 Provider 原始错误（例如 Gemini 429 JSON）作为主文案展示 | 已完成（待批量集成） | 页面按额度、限流、认证、网络、超时、服务不可用和未知错误显示可读提示、模型与可执行下一步；保留可展开诊断，不把原始转义 JSON 作为主错误文案；遵守服务端 retry delay |
| BUG-005 | 模型请求已终止失败，任务面板仍显示任务进行中与其余任务待处理 | 已完成（待批量集成） | 终止型模型失败后当前任务进入明确失败/受阻状态，其余未启动任务不再显示为仍会自动执行；用户可重试或切换模型后恢复 |
| BUG-006 | Agent 环境自检把系统 Shell、`~/.dsh` 开发 Profile 与桌面内置 Runtime 混为一谈，误报 Node/pnpm、Profile 和 Web Server 缺失 | 已确认 | 自检明确报告当前运行面的 `DSH_HOME`、CLI 来源、Node 来源和实际监听地址；桌面内置 Runtime 正常时不得建议安装全局 CLI 或重建无关的 `~/.dsh/profiles/web` |

## 后续分支

| ID | 能力缺口 | 状态 | 下一可验收结果 |
| --- | --- | --- | --- |
| GAP-001 | 动态 Cordis 插件只能提交纯 JavaScript，不能直接使用 TypeScript/JSX | 已完成（待批量集成） | 提供受控 TS/TSX 构建入口或明确的正式 Client 插件开发路径，不在运行时执行任意源码 |
| GAP-002 | `cordis_define` 插件仅驻留进程内存，重启后丢失 | 已完成（待批量集成） | 已确认插件定义进入版本化、可撤销的持久 owner，并在重启后按原 identity 恢复 |
| GAP-003 | Client 插件修改缺少自动构建/HMR | 已完成（待批量集成） | 开发模式变更能自动构建并更新页面；发布模式不装载 HMR |
| GAP-004 | 空工作区缺少初始化引导 | 已反馈 | 用户可从空目录创建或选择工作区，页面给出明确下一步而不是空白状态 |
| GAP-005 | 缺少内建浏览器自动化与专用数据库工具 | 已反馈 | 先按 capability/permission 边界交付一个真实可审批的浏览器自动化纵向切片；数据库按独立 Provider 后置 |
| GAP-006 | 未配置用户 Preset 时完全依赖默认 Profile | 已反馈 | 首次启动可选择安全内建 Preset，并能从设置中查看当前来源和恢复默认值 |
| GAP-007 | Workflow/Subagent 节点崩溃后不可恢复 | 已完成（待批量集成） | 一个持久 Workflow 可在主进程重启后恢复到明确的 pending/running/terminal 状态 |
| GAP-008 | 缺少可视化 Task/Workflow Dashboard | 已完成（待批量集成） | 在保持 DSH Client 交互基线的前提下显示真实 Job/Subagent 状态与恢复入口，不复制后台状态机 |

## 处理规则

- 新反馈先追加到本文并给出唯一 ID；未复现的内容标为“已反馈”，不先写成确定根因。
- 用户主流程与安全/权限错误优先；体验增强和新能力按独立纵向切片推进。
- 状态改为“已验收”必须附真实页面、进程、产物或聚焦测试证据；仅有代码或文档不算完成。
- 外部 Aistaff artifact、设备身份或 Cloud owner 缺失时标为“外部阻塞”，不以 Fixture 或空成功代替。
- 参考源码优先使用本机已冻结的 DsAgent；本机证据不足时允许从 GitHub 获取权威上游并先验证可用性、许可证和不可变基线，再决定是否采用。
- 桌面发布验收与交付只生成 macOS DMG；ZIP 不再作为发布产物。
- 集中修复阶段禁止自动 stage/package/make；只有用户明确授权“可以打包”后才生成新的 DMG。
- 集中修复阶段每个独立改动只运行所属包的单元、类型、组件和直接必要的负向测试；全仓构建、组合 Web/Desktop Runtime、制包与产物检查累计到用户授权打包前统一执行一次。安全、权限、持久数据和不可逆副作用变更仍须当场验证失败路径。

## 当前证据

- BUG-001：弹窗名称来自 Electron/Chromium 的 CookieEncryption OS Crypt 路径，不是模型密钥或 Supervisor 数据密钥；AI Staff Renderer 当前不以 Cookie 持有这些凭据。
- BUG-003：新会话组合默认仍是 `workspace-write + ask`；本机投影中 `never` 只出现在已选择 `danger-full-access` 的会话。修复目标是调整 AI Staff 客户预设，而不是破坏 DSH 的无人值守模式。
- BUG-001 验收：DMG 中 CookieEncryption fuse 为 Disabled，主进程不再通过 Electron ESM named import 提前初始化 `safeStorage`；从 DMG 以全新用户数据启动、刷新并退出，Renderer/HTTP 正常且系统中没有 `SecurityAgent` 弹窗。
- BUG-002 验收：真实浏览器在 `clipboard-write` 被拒绝时点击助手消息复制，随后只授予读取权限，剪贴板精确得到消息正文；同一修复后的 Client bundle 已进入 DMG Runtime。
- BUG-003 验收：实际桌面 Runtime 展开配置为默认 `workspace-write`，三个客户预设均为 `ask`；旧会话不篡改历史，重新选择任一预设即可从历史 `never` 恢复。
- BUG-006 证据：当前系统已有 Node `v26.5.0` 与 pnpm `11.7.0`；已安装客户端由包内 `Resources/runtime/apps/cli/lib/bin.js` 启动，并在 `127.0.0.1:53488` 返回 HTTP 200。桌面使用 `~/Library/Application Support/@deepseek-ai/dsh-aistaff-desktop/dsh`，不是诊断中检查的 `~/.dsh`。
- BUG-004/005 聚焦证据：真实 Loader/Web keyless 用例证明原始 429 JSON 与模拟 Secret 不进入页面，失败提示给出分类和下一步；同一失败回合的任务投影只剩 `completed`、`failed`、`blocked`，无 `pending` 或 `in_progress`。
- GAP-001/002/003 聚焦证据：动态 Plugin 定义、immutable Package 与最后成功 artifact 可跨重启恢复为 stopped；Host TS 与 Client TS/TSX 构建为普通 JavaScript；开发 watcher 的失败构建不替换旧 UI，成功构建经现有 Fiber dispose/load 路径更新。`pnpm run dev:aistaff` 只在隔离开发 Profile 开启 watcher，发布默认关闭。
- GAP-007/008 聚焦证据：真实 Loader/worker 的开放 Workflow 在第二个 Loader resume 后收敛为 `interrupted` 且不会自动重放；当前会话页头看板可聚合运行与步骤，并提供检查和二次确认的从头重试入口。
