# document/ — 本机文档转换

[English](README.md) | 中文

Host 适配器在纯文本模型请求前使用的文档转 Markdown 能力。

| 包 | 职责 | ctx key |
|---|---|---|
| [`document-converter/`](document-converter/README.md) | 与提供方无关的转换服务 | `ctx.documentConverter` |
| [`document-converter-mac-ocr/`](document-converter-mac-ocr/README.md) | 面向图片与 PDF 的 macOS Apple Vision provider | 提供 `ctx.documentConverter` |

macOS provider 在非 Darwin 组合中停用；Windows 与 Linux 可以增加另一个 provider，无需修改 Host 消费方。
