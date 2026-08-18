# @voyaseek-ai/dsh-document-converter

[English](README.md) | 中文

与 provider 无关的 `ctx.documentConverter` 服务把完整的内存文档转换为 Markdown。调用方继续拥有源数据；provider 返回完整 Markdown 值，不发布输出文件。

## 模型体验

间接影响。Consumer 决定是否让转换后的 Markdown 对模型可见，并且必须通过所属的会话事件记录该输入。

#### KV Cache 影响

Consumer 把转换后的 Markdown 加入模型请求时，它会改变受影响的请求后缀。

## 已知限制与延后工作

- 服务接收完整的内存输入；大文档流式传输尚未实现。
- 布局产物、嵌入图片和 provider 专用 JSON 不进入共享结果。
