# Agent Note：端点自有的协议修正优先于 pi-ai URL 检测

[English](2026-08-16-dashscope-endpoint-wire-corrections.md) | 中文

状态：已实现

## 问题

DashScope 的 OpenAI 兼容端点可以在模型界面中获取，但其聊天模型在会话中失败。家族知识库用 `reasoning: true` 标记已知推理家族；当 pi-ai 根据 URL 得出的兼容性检测认为端点支持 `developer` 角色时，其 OpenAI completions 分发会把推理模型的系统提示词作为 `role: 'developer'` 发送。DashScope 是未识别的 OpenAI 兼容主机，因此检测默认启用该支持，端点以 HTTP 400 返回 `"developer" is not one of ['system', 'assistant', 'user', 'tool', 'function']`。每个 agent 会话都有系统提示词，所以这条路由上的所有推理模型都不可用，而同一路由的非推理模型正常。真实探测在 `dashscope.aliyuncs.com` 的两种 id 拼写上复现了 deepseek-v4-pro/-flash、kimi-k2.7-code、glm-5.2、qwen3-max 和 qwen3.8-max 的问题。

## 决策

物化过程在 profile 兼容性链之后应用端点自有的兼容性修正，因此端点事实优先于已安装目录条目、路由开关和模型条目。如果解析后的 baseURL 主机是 `dashscope.aliyuncs.com` 或 `dashscope-intl.aliyuncs.com`，就强制设置 `supportsDeveloperRole: false`；pi-ai 随后以所有 OpenAI 兼容端点都接受的 `system` 角色发送系统提示词。修复后使用同一组探测重新验证：所有先前失败的模型都能完成携带工具的请求，选择 `reasoning_effort: high` 也成功，因此保留家族表中的 effort 声明。DashScope 对未激活模型有两种拒绝措辞（`The product is not activated` 和纯文本 `Access denied`/`access_denied`）；流分类器现在统一映射为 `MODEL_ACCESS_DENIED`。

## 已考虑的替代方案

我们否决了在桌面 profile 中设置修正或要求用户配置，因为这是端点自身事实，不属于部署环境，而且任何指向该端点的路由都会出现该问题。我们否决了修改 pi-ai 的 `detectCompat`，因为供应商包保持固定版本，产品知识应位于 harness。我们也否决了从家族表删除 `reasoningEfforts`，因为故障来自角色切换而非 effort 参数，删除会隐藏端点已经证明支持的 effort 选择。

## 影响

来自 DashScope 的推理模型无需配置即可在会话中工作，并保留家族能力和可选 effort。该修正不会缩减正常端点的能力，因为 `system` 是通用的 OpenAI 兼容系统角色。有证据表明其他端点存在相同拒绝行为时，可加入同一修正表；缺少 `DASHSCOPE_API_KEY` 时自动跳过的真实 API 测试 `dashscope.e2e.ts` 会保护列表范围和携带工具的请求路径。
