# @voyaseek-ai/dsh-document-converter-mac-ocr

[English](README.md) | 中文

本机 `ctx.documentConverter` provider，基于 MIT 许可的 `mac-ocr@1.1.1` Node API 及其随包提供的通用 Swift 二进制文件。它把图片和 PDF 字节交给同一台 Mac 上的 Apple Vision 框架处理，以流式方式读取 PDF 页面，并按输入返回纯 Markdown；不使用临时文件、Python、模型下载、API Key 或托管请求。

Provider 在一次操作中接受多个输入，并保持输入和页面顺序。`languages`、`fast`、`timeoutMs` 与 `maxOutputBytes` 是部署配置。它有意舍弃可搜索 PDF 生成、URL、密码、边界框、置信候选、结构化文档识别和上游服务模式。

## 模型体验

间接影响，由 Host 图像回退决定是否把 OCR Markdown 加入文本模型请求。

#### KV Cache 影响

OCR Markdown 会在相应请求后缀中替换图像块。

## 已知限制与延后工作

- 这个 provider 只支持 macOS 10.15 及以上版本；Windows 与 Linux 发行物需要另一个 `ctx.documentConverter` provider。
- 可选的 `mac-ocr` runtime 在首次转换时加载；省略 optional dependencies 的安装仍可组装该 provider，但在安装该 runtime 前转换会以 `FAILED` 失败。
- OCR 保留识别出的文字与页面顺序，但不能替代对场景或物体的通用视觉推理。
- 输入与完整 Markdown 都会在内存中缓冲，并受调用方和 provider 限制。
