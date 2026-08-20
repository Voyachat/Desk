# @voyaseek-ai/dsh-premature-stop-recovery

[English](README.md) | 中文

该 guard 恢复一种范围严格的错误完成：默认 agent loop 收到提供方 `stop`，最后一条 assistant 消息不含工具调用，并且其可见中文或英文尾句无条件承诺立即执行搜索、下载、检查、编辑或命令等动作。guard 在 `agent/turn-stopping` 阶段加入一条插件来源的 steering 消息，让该动作在同一 Turn 的另一个 Step 中运行。

正常结果陈述、条件式提议、包含工具调用的响应、提供方错误、取消和 `max-tokens` 结束仍会终止。检测器不判断整个用户任务在语义上是否完成；复杂目标继续使用自身的 goal 与验证策略。

## 配置

```yaml
- id: premature-stop-recovery
  name: '@voyaseek-ai/dsh-premature-stop-recovery'
  config:
    maxContinuations: 3
```

`maxContinuations` 默认为 `3`，且必须是正整数。它限制的是两次成功 `tool/result` 之间连续匹配但没有具体进展的响应次数；失败结果（包括参数 schema 校验失败）不会重置计数，因此长任务只有在工具持续取得具体进展时才会继续运行。达到无进展上限后，guard 会准入最后一个报告 Step，要求说明任务尚未完成、最后一个具体结果或阻塞，以及准确的恢复动作。如果该报告仍以动作承诺结束，guard 会写入 warning 并允许 Turn 关闭，避免无限循环。

## 持久诊断

每条恢复提示都会追加为 `user/message`，其来源为 `{ kind: 'plugin', plugin: 'premature-stop-recovery', form: 'notice' }`。`summary` 记录 `Automatic continuation <n>/<limit>` 或 `Recovery limit reached (<limit>)`。因此，常规 Session 日志导出命令会在同一份 JSONL 产物中包含原始提供方结束原因、未完成的 assistant 文本、每次恢复决策和最终 `turn/end`；guard 不创建第二套日志或私有 transcript。

## 模型体验

### 动作继续

#### 模型看到的内容

当提供方停止与检测条件匹配且仍有继续预算时，下一个同一 Turn 请求会包含以下保留的插件来源消息。

##### 继续提示词

```markdown
Continue the unfinished task now. The previous response announced an immediate action but did not perform it. Take the next concrete action with the available tools. Do not narrate, plan, or promise another action without executing it. Continue toward the requested deliverable until it is complete. If the task is actually complete or cannot safely continue, state the result or blocker explicitly instead.
```

#### Token 影响

没有停止匹配时为零 token。每次恢复会将固定提示词加入保留的 Session 历史一次。

#### KV Cache 影响

仅追加；恢复消息位于可复用请求前缀之后。

### 恢复上限报告

#### 模型看到的内容

同一 Turn 连续达到 `maxContinuations` 次匹配且期间没有工具结果后，最后一个同一 Turn 请求会包含以下保留的插件来源消息。

##### 上限提示词

```markdown
Automatic continuation made no concrete progress after repeated attempts. Do not promise another action in this step. Tell the user plainly that the task remains incomplete, name the last concrete result or blocker, and state the exact next action needed to resume.
```

#### Token 影响

只有一个 Turn 用尽继续预算时才会加入一次固定提示词。

#### KV Cache 影响

仅追加；上限消息位于可复用请求前缀之后。

## 已知限制与暂缓事项

- **文本检测** — 有界的中文与英文承诺形式可能遗漏其他措辞或语言；宽泛的语义完成判断属于显式 goal 验证器，而不是该 guard。
- **仅使用默认 loop 证据** — 不记录标准 `assistant/chunk` 提供方结束原因的其他 Agent driver 保持不变。
