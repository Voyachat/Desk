# Agent Note: Product locale 驱动 UI 与模型可见输出

Status: implemented

[English](2026-08-15-product-locale-model-context.md) | 中文

## Problem

Web 语言选择器只会选择浏览器字典。因此，Agent 回复和生成物会遵循模型推断或提示词碰巧使用的语言，而不是用户的产品偏好。浏览器检测结果也只是一项暂定值，所以在全新 profile 中，Host 侧模型组装无法解析出相同的有效语言。

## Industry evidence

Android 的[逐应用语言指南](https://developer.android.com/guide/topics/resources/app-languages)把应用语言视为一项由系统设置与应用内选择器共享的集中持久偏好，并把系统语言作为回退项。Unicode CLDR 的[语言匹配指南](https://cldr.unicode.org/downloads/cldr-43)规定，显式用户选择优先于推断匹配。W3C 的 [HTML 语言指南](https://www.w3.org/International/docs/bp-html-lang/)使用 BCP 47 内容标签，并以 `zh-Hans` 标识简体中文。OpenAI 的 [Model Spec 指令层级](https://model-spec.openai.com/2025-02-12.html)会让高权限级别的绝对指令优先于用户指令，因此产品语言以可覆盖的默认值表达，而不是无条件的系统命令。

## Decision

`locale.preference` 是产品的权威语言偏好。浏览器 locale 注册表使用它选择 UI 字典。Host 值缺失时，全新的本地回环浏览器只暂时使用受支持的 `navigator` 偏好，随后通过既有 settings scope 持久化该有效选择。显式选择和后续 Host 读取会实时替换暂定值。

Host 侧通过 `systemPrompt.context()` 贡献 `user:locale`。agent loop（智能体循环）会在模型请求前记录完整的运行时上下文快照，因此每个会话都能重建语言输入，并在偏好改变后收到一份替代快照。该上下文为 Agent 回复以及 UI、HTML、表格、电子表格、文档、演示文稿和图片中新建的用户可见文本定义默认语言。当前用户消息可以针对其指明的回复或生成物提出显式语言要求；除非请求翻译，否则已有内容保持原语言；代码、标识符、命令、路径、日志、专有名词和引用的源文本不会被自动翻译。生成的 HTML 使用该偏好的 BCP 47 内容标签。

## Alternatives considered

可变的进程全局 locale 会分裂浏览器与 Host 状态，并使模型输入缺席会话日志。静态系统提示词段落会在偏好切换后改变请求头，还会让默认语言获得高于用户当前语言要求的权限。给每个生成器分别添加语言字段会重复策略，也会漏掉 Agent 直接产生的生成物。

## Consequences

UI 文本会立即变化，每个活跃会话会在下一次模型请求时采用新偏好；已有消息和文件保持不变。稳定系统提示词不会变化，替代的运行时上下文消息会追加到保留历史之后。非回环浏览器仍只保留进程内选择，因为 Host settings API 不授权远程写入，所以其 Agent 继续使用 Host 偏好。
