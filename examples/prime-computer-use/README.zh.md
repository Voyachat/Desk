# Prime Agent computer-use 子代理

[English](README.md) | 中文

DSH 会通过 ACP 自动暴露由单独安装的 Prime Agent `v0.7.3` 子进程提供的语义桌面控制。子进程加载 `@injaneity/pi-computer-use@0.5.0`；DSH 复用现有 ACP subprocess provider，不导入 Pi 的 agent loop、扩展 API、原生 helper 或安装脚本。

## 前置条件

先通过经过审核的官方分发安装固定版本的 Prime Agent，再显式安装固定版本扩展：

```sh
prime-agent package install npm:@injaneity/pi-computer-use@0.5.0
```

该扩展的安装过程可能下载或编译原生 helper、注册 macOS 应用、创建本机签名材料，并请求辅助功能与屏幕录制权限。应在 DSH 之外按正常软件分发审核流程完成安装。不得把这些权限授予不可信的二进制文件或用户账户。

## 自动注册

启动时，base composition 会要求已配置的 subprocess provider 解析 `prime-agent`。可执行文件存在时，DSH 注册 `prime-computer-use` provider，标准模式、PTC 模式与 Cordis 模式随即自动暴露 `computer_use`；不存在时 provider 与工具都会省略，普通会话不会收到一个不可执行的 schema。每个任务都不需要开关、overlay、slash command 或重启环境变量。

工具描述会引导模型只在任务确实需要观察或操作已安装 GUI 应用时选择 `computer_use`。每次调用都会在当前工作区启动一个新的 Prime Agent ACP 子进程。子进程只收到独立委派任务，不接收 parent 对话，并且只返回最终 assistant 文本。Prime Agent 自己保留会话和工具轨迹。只使用文件、shell 或 Web API 的任务不会启动子进程。

随发行版交付的配置刻意启用 Pi 的严格后台模式，关闭浏览器控制和光标覆盖，移除 Prime Agent 内置工具，并且只允许有状态桌面操作。ACP 桥会拒绝权限提示。这些设置缩小了执行面，但不提供应用 allowlist 或操作系统沙箱。

## 验证

使用不含敏感信息的应用和隔离测试账户：

1. 启动标准模式、PTC 模式或 Cordis 模式，并确认 `prime-agent` 位于 `PATH` 时，无需 patch 即出现 `computer_use`。
2. 不指定工具，直接要求 DSH 列出可见应用 root；确认它自行选择 `computer_use` 且不执行动作。
3. 要求它观察一个测试窗口并报告指定控件。
4. 要求它通过语义动作修改一个可丢弃字段，然后核对 successor state。
5. 确认子进程在返回后退出，并且轨迹中没有浏览器、shell、文件系统或包管理工具。

不要把这份参考配置用于密码管理器、钥匙串、安全设置、管理员提示、财务系统、生产控制台或受监管数据。生产部署仍需签名 helper、应用／窗口 allowlist、协议认证与帧大小上限、截图留存策略、DLP，以及对有副作用动作的审批。
