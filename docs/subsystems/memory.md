# Cross-session Memory

English | [中文](memory.zh.md)

The memory seam owns user-manageable facts outside any one session log. `MemoryItem` identifies a bounded conversation record and cites its source session and turn. Providers define persistence and ranking; consumers derive scope from trusted sessions rather than accepting identity fields from model or browser input.

The default consumer offers each completed turn to `capture()` and calls `recall()` before the first model step of a later session. Recalled text is an untrusted, plugin-sourced `user/message`, so the ordinary session projection records exactly what the model received. Provider failures do not block the current turn.

The shipped single-user desktop provider stores a bounded item map in the user settings document. It computes capture identity from session and turn, serializes writes, uses exact-project scope plus lexical ranking, and exposes list, delete, and clear operations to the loopback Settings page. A shared Host must replace it with an identity-scoped provider; SQLite or a hardened remote provider can do so without changing consumers.

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
