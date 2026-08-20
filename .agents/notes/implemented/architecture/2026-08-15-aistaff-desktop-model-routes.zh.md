# Agent Note：AI Staff 桌面版拥有本地模型路由默认配置

[English](2026-08-15-aistaff-desktop-model-routes.md) | 中文

状态：已实现

## 问题

独立运行的桌面版需要一个可用的默认模型，但不得将凭证（credential）硬编码至代码仓库、自动生成的用户配置文件、Renderer 进程、命令行参数、日志或打包产物中。在 macOS 平台上，Node 提供方（Node provider）的请求还需遵循系统当前生效的代理设置，而捆绑分发的 DSH 页面则必须持续使用其直连回环（loopback）连接。

## 决策

AI Staff 桌面版配置文件注册了 `google/gemini-3.6-flash` 和 `dashscope/qwen-plus` 两个模型，其中 Gemini 作为首个创建的配置文件，默认成为首选模型。该决策仅适用于 AI Staff 专属配置文件；共享的 DSH 模型目录及全局默认配置文件均保持不变。桌面版仅迁移其此前生成的、内容为空的补丁（empty patch），其余所有已存在的用户补丁均完整保留。

Electron 主进程从 `~/.codex/secrets` 目录下读取模型凭证，该目录内文件须满足常规权限限制（仅属主可读写）、所有权明确且路径范围受限。主进程仅接受预定义名称的环境变量，并将其值透传至 DSH 子进程环境。显式通过启动命令设置的环境变量具有最高优先级。配置文件中仅存储环境变量名称，绝不存储其实际值。

主进程会解析 Electron 当前生效的系统代理配置，并同时应用于两类提供方端点（provider endpoints）。它仅将合法的、不含凭证的 HTTP(S) 权限地址（authority）转换为 Node 进程可识别的代理环境变量。显式通过启动命令指定的代理变量仍具最高优先级。对于主机流量（Host traffic），`NO_PROXY` 环境变量中始终同时包含 `127.0.0.1` 和 `localhost` 两种拼写形式。在 Renderer 进程执行页面导航前，BrowserWindow 实例会独立解析 Runtime URL；若任一代理指令非 `DIRECT`，则启动失败——此举可确保未加密的回环页面绝不会退而使用代理。

## 影响

打包发布的产品可在不引入密钥存储服务（secret store）或 Renderer 进程桥接机制的前提下，直接使用本地 Gemini 与 DashScope 凭证。若本地凭证文件缺失，系统不会因此阻塞启动流程；此时仍沿用现有 DSH 的凭证错误提示作为用户可见的失败信息。针对按域名拆分的 PAC（Proxy Auto-Configuration）脚本结果、以 `DIRECT` 开头的代理规则、SOCKS 代理以及需身份认证的代理条目，本方案不予转换；当 Node 进程无法直连时，必须显式指定受支持的启动代理。真实的 DSH 冒烟测试（smoke check）会同时验证两条路由，并仅记录路由名称与成功标记。
