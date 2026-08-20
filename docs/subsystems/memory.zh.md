# 跨会话记忆

[English](memory.md) | 中文

记忆 seam 持有不属于单一会话日志、可由用户管理的结构化偏好、事实、约束与可过期事件。每个 `MemoryItem` 都有稳定语义键，并引用来源会话与轮次。Provider 决定持久化与排序；Consumer 从可信 Session 派生作用域，不接受模型或浏览器输入的身份字段。

默认 Consumer 只排队每个已完成轮次中的直接用户文本，再通过 `ctx.llm` 使用该会话已路由模型，针对相关候选生成并验证 upsert、delete 或 no-op mutation。Assistant 消息和其他生成内容绝不会进入提炼，并且只能保留用户明确说出的信息。Provider 事务提交后，一条持久维护事件会记录发生变化的精确条目 ID。同一 Consumer 会在后续会话的第一个模型步骤前调用 `recall()`，并提供显式搜索、记住与遗忘工具。召回文本是一条不可信、来源为 `agent-memory` 的 `user/message`，因此普通会话投影会准确记录模型收到的内容，浏览器也能提供精确条目纠正入口。

随产品交付的单用户桌面 Provider 把控制项放在 Settings，把数据放在 owner-only SQLite。疑似 secret 的输入会在 durable outbox 或提炼调用前被拒绝；`(session, turn)` 让排队采集幂等；`workspace + kind + semantic key` 让纠正覆盖旧值。事件会过期，失败提炼按配置做有界重试，词法／关键词召回结合重叠度、置信度与更新时间。低强调对话行显示已提交维护结果与召回来源；其中的编辑器和独立于外壳的 Settings 区域通过专用且仅限 loopback 的特权 API 列表、更新、删除与清空，不会收到数据库路径。共享 Host 必须换成以已认证员工身份为作用域的 Provider。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentmemory--agentmemory-abstract-seam"></a>

### `ctx.agentMemory` — `AgentMemory` (abstract seam)

Provider-neutral service consumed by context, tool, and management plugins.

```ts cordis-catalog
/**
 * Read current configuration, item count, and pending maintenance state.
 * @returns current provider status.
 */
abstract status(): AgentMemoryStatus

/**
 * Durably queue one completed turn after provider-owned secret filtering.
 * @param request - trusted Session-derived completed turn.
 * @param options - optional cancellation.
 * @returns queue outcome.
 */
abstract capture( request: CaptureMemoryRequest, options?: MemoryOperationOptions, ): Promise<'queued' | 'duplicate' | 'disabled' | 'filtered'>

/**
 * Process durable pending captures through the supplied automatic maintainer.
 * @param maintainer - candidate-aware extractor and consolidation callback.
 * @param options - optional cancellation.
 * @returns bounded pass counts.
 */
abstract maintain( maintainer: MemoryMaintainer, options?: MemoryMaintenanceOptions, ): Promise<MemoryMaintenanceResult>

/**
 * Store or replace one explicit structured memory.
 * @param request - trusted Session-derived explicit memory.
 * @param options - optional cancellation.
 * @returns committed item.
 */
abstract remember(request: RememberMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem>

/**
 * Correct one existing item without changing its identity, kind, scope, or origin.
 * @param request - exact provider-issued identity and replacement user-visible fields.
 * @param options - optional cancellation.
 * @returns committed item.
 * @throws when the item does not exist or the replacement contains sensitive content.
 */
abstract update(request: UpdateMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem>

/**
 * Recall relevant, unexpired items in provider-defined rank order.
 * @param request - trusted query and scope.
 * @param options - optional cancellation.
 * @returns ordered matching items.
 */
abstract recall(request: RecallMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem[]>

/**
 * List stored items newest first for a local management surface.
 * @param options - optional cancellation.
 * @returns every user-manageable item.
 */
abstract list(options?: MemoryOperationOptions): Promise<MemoryItem[]>

/**
 * Delete explicitly identified items.
 * @param ids - exact provider-issued identities.
 * @param options - optional cancellation.
 * @returns number deleted.
 */
abstract forget(ids: readonly MemoryId[], options?: MemoryOperationOptions): Promise<number>

/**
 * Delete every stored item and pending capture while retaining configuration.
 * @param options - optional cancellation.
 * @returns number of committed items deleted.
 */
abstract clear(options?: MemoryOperationOptions): Promise<number>
```

Source: [`packages/memory/agent-memory/src/index.ts:185`](../../packages/memory/agent-memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
