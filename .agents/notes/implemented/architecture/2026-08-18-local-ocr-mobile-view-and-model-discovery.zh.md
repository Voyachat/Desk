# Agent Note：本机 OCR、只读手机查看与模型发现

Status: implemented

[English](2026-08-18-local-ocr-mobile-view-and-model-discovery.md) | 中文

## Problem

纯文本模型路由需要在不消耗视觉 API 调用的情况下获得图片文字；手机需要一种不继承桌面控制面的窄权限方式来观察活跃会话；模型选型需要权威的中文生态发现能力，但不应引入完整训练 SDK。这些能力的信任和平台约束不同，合并为一个远程 Agent 服务会耦合无关权限。

## Decision

`ctx.documentConverter` 是由自动图片 fallback 消费的 provider-neutral 文档转 Markdown seam。随附的 Darwin provider 依赖 `mac-ocr@1.1.1`，通过其 Node API 把字节交给通用 Swift 二进制，并按输入顺序和 PDF 页序返回有界文本。基础 bundle 在 Darwin 之外禁用该 provider。后续[自动图片 fallback 路由决策](2026-08-19-automatic-image-fallback-routing.md)负责托管与本机的顺序。

`mobile-view` 注册本机 `/mobile-view` 页面和两个使用 Bearer 认证的 JSON 读取接口。配置 `remoteHost` 时，它会启动第二个只提供这三条路由的 HTTP listener。listener 绑定前必须取得凭据，且不会暴露主 Web server、命令、工具、文件、上传、下载、cookie 或写方法。token 只保留在页面内存和请求 header 中。

`modelscope_search` 通过受管子进程 seam 调用固定版本的官方 `modelscope-hub==0.2.0` 客户端，并只投影有界仓库元数据。API token 进入子进程环境而不是 argv。模型下载、仓库代码执行、上传、训练、服务、插件、MCP 和完整 `modelscope` SDK 均不进入该插件。

## Alternatives considered

Docling 未作为 macOS 图片降级实现，因为其固定版本 CLI 在受支持的 Intel Mac 上即使使用 Python 3.12，仍反复进入耗时的 `docling-parse` 源码构建。没有同时引入 PaddleOCR 与 Docling，因为两套重量级 OCR 栈会重复承担运行时、模型和打包成本。`mac-ocr` 提供经测试的通用二进制，复用操作系统识别器，不需要模型缓存或 API key，并支持多图片与 PDF。

没有复制 DSH Remote 实现。它的通用远程控制范围、query 或浏览器持久化 token 模式、文件传输、命令、daemon 和通配 listener 超出了消息查看器权限。本机插件只保留产品思路，并复用既有 WebServer、SessionQuery 与 credentials 服务。

没有采用完整 ModelScope SDK，因为目录发现只需要独立发布的 Hub 客户端。直接下载仓库或执行本机模型可在以后作为独立 capability seam 加入，并分别处理许可、存储与代码执行策略。

## Consequences

macOS 获得无 key OCR 路径，其包和上游基线锁定在开源采用台账与第三方许可清单中。Windows 和 Linux 保持 seam 未提供，而不会静默使用不兼容 provider。OCR 只抽取文字，不替代场景理解；系统不把任何托管 provider 描述为永久免费，也不内置 key。

手机远程访问需要显式 listener host 和已配置 bearer credential。TLS 由私有 mesh 或带 allowlist 的反向代理负责。ModelScope 搜索首次使用时可能填充 uv 包缓存，但不会改变应用状态或执行模型仓库。
