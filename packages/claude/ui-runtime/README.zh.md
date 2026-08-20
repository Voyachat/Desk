# @voyaseek-ai/dsh-claude-runtime-ui

[English](README.md) | 中文

编辑器 Runtime 选择器：标识当前会话使用的 agent 驱动，即本机模式（DSH 循环）、Claude（Claude Agent SDK 驱动）或 Codex（OpenAI Codex 驱动），并允许在三者之间切换。

浏览器端占用 `conversation.input.left` 编辑器 slot，位于常驻控件右侧、计划模式 chip 旁。Node 端是空的 apply，仅用于让该插件进入 Host 组合；界面通过 `dsh.client` manifest 中的 `exports["./client"]` 交付。

## 行为

会话 header 自身的 Runtime 永不改变。该 chip 因而承担两项职责：

- **标识。** 始终显示当前会话 header 记录的 Runtime，字段缺省时表示本机模式；每次列表选择变化时都跟随当前会话。
- **切换。** 从空白会话选择其他驱动时，在所属 Workspace 中连接该 Runtime，复用或创建匹配的空白会话。从已有完成历史的对话切换时，在目标 Runtime 下 fork 所保留的 transcript，并打开子会话；源会话保持不变。瞬时 toast 会提示：对话内切换模式可能降低执行效果，因为提供方私有的推理、工具状态与 cache 无法精确转移。

与之配对的 Host 端是部署 patch layer 中的 `claude-agent` 与 Codex 驱动配置项；若所选驱动未挂载，切换会在 `session.create` 以 `runtime-not-found` 明确失败，chip 会显示失败信息。

## 模型体验

### 对话 Runtime 选择

#### 模型看到的内容

本 UI 包不插入任何内容。跨 Runtime fork 会使目标替代驱动在首轮把所保留的可见 transcript 作为 user 级 recall 加入；该行为由 `dsh-agent-loop` 与所选驱动拥有。

#### 对 token 的影响

选择器自身不增加 token。跨 Runtime 子会话会在替代驱动的首轮一次性计入所保留的 transcript recall。

#### 对 KV Cache 的影响

空白会话切换不影响 cache。跨 Runtime 对话 fork 会启动新的提供方续接，因此无法复用源 Runtime 的提供方 cache。

## 已知限制与暂缓事项

- 列表固定为本机、Claude 与 Codex。部署挂载其他 agent 驱动时，选择器仍不会列出它们，直至该界面改为读取 Host 的 `driverRuntimes()` 注册表。
- 对话切换是在同一 Workspace 中创建子 fork，不会修改源会话。可见历史与当前 DSH 上下文会转移，但提供方私有推理、工具状态、审批和 cache 不会转移；因此 UI 不承诺切换后的执行效果完全一致。
