# @voyaseek-ai/dsh-mobile-view

[English](README.md) | 中文

位于 `/mobile-view` 的响应式只读会话查看器。页面只在当前页面内存中保留 Bearer Token。JSON 路由只接受 `Authorization: Bearer`；不存在查询参数 Token、Cookie、写操作、命令、文件访问、上传、下载或远程进程控制。

通过 credentials 服务设置 `VOYASEEK_MOBILE_VIEW_TOKEN`。设置 `VOYASEEK_MOBILE_VIEW_HOST=0.0.0.0` 后，插件会在 3081 端口启动一个独立的只读监听器；它只暴露三条 `/mobile-view` 路由，并且在缺少 Bearer 凭据时拒绝启动。该监听器不会暴露主 Web 服务器或其控制 API。相较公网端口，仍应优先使用私有组网或带允许列表的反向代理。插件行可覆盖 `remoteHost` 与 `remotePort`；插件不会启动隧道。

## 模型体验

无。插件只读取已提交的会话事件，不改变模型输入。

#### KV Cache 影响

无。

## 已知限制与延后工作

- 页面轮询有界快照；有意不实现推送传输和离线缓存。
- 传输加密由可信私有组网或反向代理负责；独立监听器不终止 TLS。
- 查看器只渲染用户消息和助手消息中的文字。
