# Aistaff Cloud 本地一致性测试

[English](README.md) | 中文

专为 `@voyaseek-ai/dsh-aistaff-cloud-conformance` 中显式 `local_read` 场景设计的仅用于测试的 Host 组合。它挂载一个固定的原生目录选择器、内存中运行的 Supervisor 提供方，以及 `LocalCapabilityCoordinator`。结果输出端将有界目录或文本输出，通过同一权威的 Cloud 测试前置数据（fixture）回传：该 fixture 拥有规范化的产物（Material）、Cloud 收据（Cloud Receipt）、已完成活动（Activity）、交互移除记录，以及可回放的 SSE 事件。

原生 fixture 路径对选择器和 Supervisor 保持私有。渲染器（Renderer）的投影（projections）与事件帧（event frames）仅包含资源显示标签、不透明句柄、规范化的产物（Material）标识符，以及不含路径的结果内容。生产环境组合包不得依赖本包。

## 模型体验

本 fixture 不引入任何模型输入或工具 schema。其规范化的产物（Material）仅为 Host 与渲染器（Renderer）一致性测试提供测试数据。
