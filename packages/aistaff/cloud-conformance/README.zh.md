# Aistaff Cloud 兼容性测试套件

[English](README.md) | 中文

仅用于测试的确定性客户端网关产物及内存传输实现。其不可变的来源声明包含 `test_only: true`、固定的产物版本号以及固定的根哈希值。该包在运行时绝不会读取任何生产环境 URL、凭据、令牌、存储（Store）、Aistaff 工作区或外部服务。

在测试中，需将此插件挂载于 `@voyaseek-ai/dsh-aistaff-cloud-provider` 之前。它提供 `AistaffClientGatewayInputs` 输入结构与 `aistaffCloudConformance` 控制能力。默认的 `approval` 场景完整复现 V1 流程：包含一名就绪状态的 Cloud 员工、一个受快照约束的空或单条目参与度（engagement）投影、开放状态、返回 `202` 状态码的文本活动（text activity）、文本素材（text material）、审批交互（approval interaction）、回执（receipt）、素材访问（material access）、保留的操作结果（retained operation outcome）、SSE 回放（SSE replay）、重复投递（duplicate delivery）、重连（reconnect），以及一次性触发的游标过期响应（cursor-expired response）。

显式的 `local_read` 场景则将原提交的审批交互替换为由 Cloud 自主管理的 `directory/list` 交互。其仅限 Host 运行的控制逻辑负责解析当前请求，并以幂等方式将一条无路径限制的本地结果注入同一权威的素材（Material）、回执（Receipt）、活动（Activity）、基线（baseline）及 SSE 投影中。`@voyaseek-ai/dsh-aistaff-cloud-local-conformance` 插件则为该流程单独提供仅用于测试的原生选择器（native selector）、主管（Supervisor）及本地能力（Local Capability）组合。

生产环境构建包严禁依赖或挂载本包。通过绿色（即全部通过）的 fixture 运行仅能验证消费方（consumer）对这一固定本地约定的编排能力；它**不能**证明消费方与已发布的 Aistaff 产物或服务具备兼容性。

## 模型体验

无，因为该仅测试 Cloud fixture 只发布 Renderer 安全状态，不贡献提示词、模型消息、会话事件或工具 schema。

#### KV Cache 影响

无；该 fixture 不组装或发送模型请求。

## 已知限制与待办事项

- **仅限测试的 transport** —— 内存 transport 不会连接或验证生产 Aistaff 部署，也不得作为生产就绪证据。
