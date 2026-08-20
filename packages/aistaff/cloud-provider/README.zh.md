# Aistaff 云提供方

[English](README.md) | 中文

`CloudClientGatewayAdapter` 的生产环境宿主构成。上游所有者必须首先使用已批准的不可变约定产物、经身份验证的传输通道以及语义化的客户端问候（Client Hello）注册 `AistaffClientGatewayInputs`。该提供方不设默认源地址、凭据、协议选项、超时时间、分页大小、模型选择偏差或重连间隔。

若输入缺失，或初始全量投影无法完成同步，则在发布 `employeeExperience` 前即以 `CLIENT_GATEWAY_UNAVAILABLE` 错误启动失败。同步成功后，插件将发布适配器，并运行一个由生命周期管理的 SSE 重连循环。dispose（资源释放）操作会中止并等待该循环结束，之后才移除服务。

## 模型体验

本组合不引入任何模型输入、工具 schema、token 或 KV Cache 内容。

## 已知限制与待办事项

在 Aistaff 正式发布所固定的 Client Gateway 产物，且经身份验证的传输通道所有者提供 `AistaffClientGatewayInputs` 之前，生产环境组装将保持有意不可用状态。
