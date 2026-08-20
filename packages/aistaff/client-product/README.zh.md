# @voyaseek-ai/dsh-aistaff-client-product

[English](README.md) | 中文

该浏览器插件在现有侧边栏页脚中增加一个 **AI 员工** 操作，并向 shell overlay 增加员工工作台。它不会替换随产品交付的侧边栏、对话、详情或设置界面。

该包有两个显式浏览器入口。`./client` 是首个本地 UI 验收流程使用的确定性 Fixture 路径。`./cloud-client` 是生产 UI 路径并选择 `ctx.employeeExperience`；它绝不会检测、导入或回退到 Fixture 端口。两个入口以相同的视觉语言注册相同的 `sidebar.footer.action` 和 `shell.overlay` slot。

在 Electron 中，两个入口都只会在 `conversation`、`sessions` 和 `connection` 可用，而且所选 Session 真实且空白后，消费 preload 持有的启动意图。交接会应用所选 Agent Preset，在 Session 列表中记录已确认的 preset，并把文本草稿写入该 Session 的对话输入框但不发送。只有每一步都成功后才确认 Electron；缺失或非空白 Session 会保持待处理，任何失败操作都会让意图保持未确认，而且不会自动重试，因为传输失败的结果可能未知。普通浏览器部署不暴露 preload bridge，也不会执行交接。

Cloud Slot Store 只包含面板可见性、员工与互动选择、当前草稿、忙碌状态和可安全显示的错误文本。业务投影仍位于 `EmployeeExperienceObjectLayer`；一个仅引用适配器把它的原子 `observe()` 约定连接到 React `useSyncExternalStore`。Mutation 创建一个 `OperationId`，原样使用 owner 提供的 risk、revision 和 outcome 字段，并且只在 owner 报告 `UNKNOWN_OUTCOME` 时用同一个 id 查询 `readOperation`。

普通文本和 Markdown 都作为文本渲染，不使用原始 HTML。结构化材料渲染为不可交互的 JSON，链接只用于显示，产物访问通过类型化的预览／下载回调完成。当前 `client_mode: none` 流程仍禁用 `local_operation` 交互。

## 模型体验

无，因为本包只渲染产品控件，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与暂缓事项

- **Cloud 组合包选择**——DSH 模块扫描器当前只发现包的 `./client` 导出。生产组合必须显式选择已构建的 `./cloud-client` 产物；不得依赖服务探测来切换入口。
- **通用交互表单**——V1 Input 交互只显示一个安全文本值。对应约定 Feature 启用前，需要先准入 schema-form 渲染器以支持丰富字段。
- **受控材料交接**——工作台请求类型化访问授权，但后续 Electron IPC handler 才持有实际预览／下载字节和原生目标选择。
