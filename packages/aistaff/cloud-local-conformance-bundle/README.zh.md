# Aistaff Cloud 本地一致性组合包

[English](README.md) | 中文

本包是面向云服务方拥有的 `local_read` 验收路径的、仅用于测试的确定性组合。它按依赖顺序挂载以下组件：云服务方的一致性输入、生产环境云服务提供方、云本地一致性桥接器（Cloud local conformance bridge）、两个 Renderer 远程客户端，以及严格遵循云服务加本地能力要求的客户端包装层。

云本地一致性桥接器使用来自 `@voyaseek-ai/dsh-aistaff-supervisor-control/testing` 的内存内 Supervisor。该桥接器不启动也不验证 Rust 伴随进程（sidecar）。当前实际运行的 Rust 生产环境服务提供方默认禁用文件读取与目录列表功能，因此本组合包绝不可出现在任何生产环境配置文件中，亦不得被视作生产环境中已启用本地读取能力的证据。

浏览器脚手架（scaffold）通过完整的依赖列表加载两个远程客户端模块。本组合中不得包含任何生产环境组合包、`supervisor-process`、Fixture 客户端入口，或自动服务回退机制。
