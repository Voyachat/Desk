# @voyaseek-ai/dsh-image-fallback

[English](README.md) | 中文

`ctx.imageFallback` 在纯文本模型接收内容前，把持久图片内容转换为文本。只有配置的凭据引用已有值时，托管视觉路由才会执行场景理解；凭据缺失或托管调用失败时使用本机文档转换。服务不会把托管模型描述为永久免费，也不内置 provider key。

返回文本保留带编号的图片占位，并把分析放入 `<image-analysis>`。原始图片引用与 attribution 一同保留，用于对话展示、附件授权和导出。原生支持图片的目标模型绕过该服务。

## 路由与健康状态

`routes` 按顺序执行。交付配置依次使用 `glm-4.6v-flash`（`free`）、`glm-4.6v-flashx`（`paid-low`）、`glm-4.6v`（`paid-quality`），最后使用 macOS 本机 OCR。只有可用性故障（`RATE_LIMIT`、`QUOTA`、服务器、超时、传输、流关闭、空响应、适配器缺失或未知模型）才升级到下一条托管路由。认证及无效配置会停止付费升级，只允许转到本机 fallback。可用性故障路由进入 60 秒进程内冷却。

`ping_image_fallback` 会发送最小 `PING` 请求并检查每条路由声明的图片输入。默认只探测免费路由；`include_paid: true` 才明确允许探测付费路由。返回 `available`、`cooldown`、`unconfigured` 或 `not-probed`，不暴露凭据。

交付的智谱路由通过凭据服务读取 `ZHIPUAI_API_KEY`。配置后，图片会自动传给智谱，不再弹出额外确认；缺少凭据时跳过全部智谱托管路由并使用本机转换。

## Model Experience

### 自动图片回退

#### 模型看到什么

目标纯文本模型收到用户文本、带编号的图片占位和一段分析，不会收到图片字节，也不会收到要求它切换模型的消息。

#### Token 影响

托管分析会产生一次独立计量且受 `maxTokens` 限制的视觉请求；返回描述在压缩前保留在目标对话中。本机转换只增加返回的 OCR 文本。

#### KV Cache 影响

分析是只追加的文本后缀。更早的请求前缀仍可复用，描述进入后续 cache identity。

## Known Limitations and Deferred Work

- 本机转换是 OCR，不替代场景理解。
- 托管可用性、价格、额度和限流由 provider 决定，可能变化。
