# @voyaseek-ai/dsh-mobile-view

[English](README.md) | 中文

位于 `/mobile-view` 的响应式只读会话查看器。页面只在当前页面内存中保留 Bearer Token。JSON 路由只接受 `Authorization: Bearer`；不存在查询参数 Token、Cookie、写操作、命令、文件访问、上传、下载或远程进程控制。

Host 注册实时生效的 `mobile-view` 设置 namespace（`enabled`、`port`）和仅回环可访问的 `/mobile-view/api/status` 路由。本机“远程查看”设置页先通过 credentials 服务写入令牌，再启停绑定到 `0.0.0.0` 的独立监听器。该监听器只暴露页面、会话列表和单会话消息三条路由；缺少 Bearer 凭据时拒绝启动，并且绝不会暴露状态路由、主 Web 服务器或控制 API。状态响应只返回检测到的外部 IPv4 地址，不返回凭据。

`remoteHost` 与 `remotePort` 仍可作为部署组合输入；已有部署配置 `remoteHost` 后会得到初始启用状态。相较公网端口，仍应优先使用私有组网或带允许列表的反向代理。插件不提供 TLS、NAT 穿透或隧道。

## 模型体验

无。插件只读取已提交的会话事件，不改变模型输入。

#### KV Cache 影响

无。

## 已知限制与延后工作

- 页面轮询有界快照；有意不实现推送传输和离线缓存。
- 传输加密由可信私有组网或反向代理负责；独立监听器不终止 TLS。
- 查看器只渲染用户消息和助手消息中的文字。
