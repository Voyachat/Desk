# 跨会话记忆

[English](memory.md) | 中文

记忆 seam 持有不属于单一会话日志、可由用户管理的事实。`MemoryItem` 标识一条有界对话记录，并引用来源会话与轮次。Provider 决定持久化与排序；Consumer 从可信 Session 派生作用域，不接受模型或浏览器输入的身份字段。

默认 Consumer 把每个已完成轮次交给 `capture()`，并在后续会话的第一个模型步骤前调用 `recall()`。召回文本是一条不可信、插件来源的 `user/message`，因此普通会话投影会准确记录模型收到的内容。Provider 失败不会阻塞当前轮次。

随产品交付的单用户桌面 Provider 在用户设置文档中存放有界条目表。它从会话与轮次计算采集标识、串行执行写入、使用精确项目作用域与词法排序，并向仅限 loopback 的 Settings 页面提供列表、删除和清空操作。共享 Host 必须换成带身份作用域的 Provider；SQLite 或加固后的远程 Provider 均可完成替换，而无需改变 Consumer。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentmemory--agentmemory-abstract-seam"></a>

### `ctx.agentMemory` — `AgentMemory` (abstract seam)

Provider-neutral service consumed by context and management plugins.

```ts cordis-catalog
/**
 * Read current live configuration and item count.
 * @returns provider status and capacity.
 */
abstract status(): AgentMemoryStatus

/**
 * Store one completed turn idempotently.
 * @param request - trusted session-derived completed-turn content.
 * @param options - optional operation cancellation.
 * @returns whether the turn was stored, already present, or disabled.
 */
abstract capture(request: CaptureMemoryRequest, options?: MemoryOperationOptions): Promise<'stored' | 'duplicate' | 'disabled'>

/**
 * Recall relevant prior-session items in provider-defined rank order.
 * @param request - trusted session-derived query and scope.
 * @param options - optional operation cancellation.
 * @returns ordered matching items.
 */
abstract recall(request: RecallMemoryRequest, options?: MemoryOperationOptions): Promise<MemoryItem[]>

/**
 * List stored items newest first for a local management surface.
 * @param options - optional operation cancellation.
 * @returns all user-manageable items.
 */
abstract list(options?: MemoryOperationOptions): Promise<MemoryItem[]>

/**
 * Delete explicitly identified items.
 * @param ids - provider-issued identities to delete.
 * @param options - optional operation cancellation.
 * @returns number of items deleted.
 */
abstract forget(ids: readonly MemoryId[], options?: MemoryOperationOptions): Promise<number>

/**
 * Delete every stored item while retaining configuration.
 * @param options - optional operation cancellation.
 * @returns number of items deleted.
 */
abstract clear(options?: MemoryOperationOptions): Promise<number>
```

Source: [`packages/memory/agent-memory/src/index.ts:73`](../../packages/memory/agent-memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
