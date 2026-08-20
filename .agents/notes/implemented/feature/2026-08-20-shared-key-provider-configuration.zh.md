# Agent Note：提供方共享密钥配置

状态：已实现

[English](2026-08-20-shared-key-provider-configuration.md) | 中文

## 问题

一个提供方凭据可以授权多个协议兼容端点。例如 DashScope 会在同一个凭据下提供 OpenAI 兼容、Responses 与 Anthropic 兼容地址，而既有 pi-ai 路由只有在单一主 descriptor 已经使用替代 Runtime 所需协议时才允许其接入。自定义提供方表单还要求用户自行编写 Provider ID，尽管 settings 地址和凭据引用都属于实现标识符。

## 决策

`llm-pi-ai` profile 继续以 `api` 与 `baseURL` 作为 Native descriptor，并可增加 `alternateEndpoints`；每种其他受支持协议最多配置一个非空端点。所有端点共用路由的 `apiKeyEnv`；Codex 选择 `openai-responses`，Claude 选择 `anthropic-messages`，Native 仍使用主 descriptor。端点列表声明协议准入，不代表端点可达，也不代表账号拥有每个模型的权限。

Models 页面根据匹配到的配置建议或显示名称生成内部 Provider ID，并用数字后缀解决冲突。表单不再显示该字段。配置建议只在本地运行，只使用无歧义的密钥前缀或已知提供方名称，并在不传输、不保留密钥的前提下填写仍可编辑的端点值。共用的 `sk-` 前缀仍视为有歧义，因此页面会要求提供方名称或手工端点，而不会猜测。智能修复会恢复匹配的配置建议，但不会改变路由 id 或已存凭据。

AI Staff 生成的 profile 会禁用通用基础 bundle 的 DeepSeek 插件。与旧版生成内容完全一致的 profile 会迁移到该组合，用户编辑过的 profile 保持不变。

## 影响

当提供方公开三种协议时，一个自定义路由与一份凭据即可同时供 Native、Codex 和 Claude 使用。只有主端点参与模型目录询问，协议已配置标签也不声称付费请求必然成功。明确执行连通性检查时，系统会通过每个已配置 Runtime 发送固定的单 token 请求；已存凭据只在 Host 解析，且不会返回提供方响应正文。`alternateEndpoints` 是可选字段，因此既有单端点 profile 仍然有效。通用 DSH 组合继续保留 DeepSeek；只有 AI Staff 产品 profile 移除其默认行。

## 备选方案

为每种协议创建第二条提供方路由的方案被否决，因为它会重复凭据、模型目录和用户可见的提供方身份。根据每个 `sk-` 密钥推断提供方的方案被否决，因为多个提供方有意共用该前缀。把 Provider ID 保留为高级字段的方案被否决，因为它的合法性与唯一性无需用户判断即可派生，而公开该字段只会增加一次可避免的配置失败。
