# @voyaseek-ai/dsh-tool-modelscope

[English](README.md) | 中文

只读 `modelscope_search` 工具通过隔离的 uv 环境调用官方 `modelscope-hub==0.2.0` Python 客户端。它搜索公开模型元数据，也可以通过 credentials 服务解析 `MODELSCOPE_API_TOKEN` 以查看私有资源。

集成有意排除快照下载、上传、训练、pipeline、远程 server、studio、skill、插件、MCP 安装、llamafile 执行和任意模型代码。选定模型后，还必须单独评审该模型的模型卡、许可证、文件、体积和 `trust_remote_code` 要求，才能形成采用决策。

## 模型体验

工具只在被调用时加入一份有界目录结果，不增加常驻提示词章节。

#### KV Cache 影响

工具调用与结果会扩展当前请求后缀。

## 已知限制与延后工作

- 部署环境必须提供 `uv`；首次使用会下载轻量的官方 Hub 客户端环境。
- 搜索结果不能证明模型安全、许可证兼容、可在本机运行或适合生产。
- 在某个精确模型通过独立采用评审前，模型下载和执行保持不可用。
