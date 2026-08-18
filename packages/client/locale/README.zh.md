# @voyaseek-ai/dsh-client-locale

[English](README.md) | 中文

产品语言插件：`zh`／`en` 偏好以 `locale.preference` 存储在 `$VOYASEEK_HOME/settings.yaml` 中，并同时驱动浏览器文案和模型可见语言指引。若没有 Host 值，全新浏览器会暂时选择 `navigator` 请求的第一个受支持主语言，均不支持时回退到 `zh`；可写的本地回环 settings scope 会持久化该解析结果，使 Host 与浏览器消费者收敛。Host 读取保持非阻塞；接受的显式值会实时替换浏览器暂定值。settings API 仅限回环请求，因此远程浏览器的选择只保留在进程内。`locale/change` 仅在切换语言时触发。

`LocaleRuntime` 拥有 ns×locale 字典注册表（类型化 `register(ns, {zh, en})` 按 `LocaleNamespaceMap` 校验，`bind(ns)`→`TranslateNS<ns>`；查找链 ns → common → zh → key），实现 slot 系统的 `LocaleFace`，并经 `ctx.slots.installLocale` 自行安装，支撑框架注入的 `t` 标准席位（`Translate`／`TranslateNS` 是 ui-slots 的类型；请从那里导入——本包的再导出仅为字典所有者提供便利）。[产品语言 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-15-product-locale-model-context.md)说明模型请求传播方式；[Host settings 支撑的偏好决策](../../../.agents/notes/implemented/bug-fix/2026-08-06-host-backed-web-preferences.md)说明持久化范围。

## 模型体验

### 首选回复与生成物语言

#### 模型看到的内容

当前运行时上下文快照包含一项 `user:locale` 贡献。当前请求可针对其指明的回复或生成物覆盖该偏好；编辑时保留已有内容，除非用户要求翻译。

##### 简体中文

```markdown
User language preference: Simplified Chinese (BCP 47: zh-Hans). Use Simplified Chinese by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. Preserve existing content's language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. When generating HTML in this preferred language, set the document language to "zh-Hans".
```

##### 英文

```markdown
User language preference: English (BCP 47: en). Use English by default for assistant replies and newly created user-facing content in deliverables, including UI labels, buttons, navigation, forms, status and error messages, tables, spreadsheets, documents, presentations, and image text. An explicit language instruction in the current user request overrides this preference only for the reply or deliverable it addresses. Preserve existing content's language when editing unless translation is requested, and do not translate code, identifiers, commands, file paths, logs, proper nouns, or quoted source text merely to satisfy this preference. When generating HTML in this preferred language, set the document language to "en".
```

#### Token 影响

会话首次请求增加一条持久上下文快照。偏好变化会在该会话的下一次请求中增加一条替代快照；未变化的请求不增加语言偏好 token。

#### KV Cache 影响

稳定系统提示词保持逐字节一致。变化后的语言快照追加在保留历史之后，从而保留此前可复用的前缀；后续未变化的请求复用已保留快照。

## 已知限制与暂缓事项

- **部分界面仍保留内联文案**——设置行、侧边栏、问题作答器和模型选择使用 locale seat；其他包仍直接拥有静态文本。
- **注册表持有的文本只读取一次翻译**——在 slot 渲染路径之外于注册时捕获的文案（例如 command 注册表中的 `/model` 命令描述）在重新注册前保持注册时的语言；slot 渲染的文案随切换实时更新。
- **直接远程 Web 无法持久化产品偏好**——非回环浏览器可以在进程内切换 UI，但在具备可信远程 settings 写入策略前，Host 模型上下文仍使用 Host 设置。
