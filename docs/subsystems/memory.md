# Cross-session Memory

English | [中文](memory.zh.md)

The memory seam owns structured, user-manageable preferences, facts, constraints, and expiring events outside any one session log. Each `MemoryItem` has a stable semantic key and cites its source session and turn. Providers define persistence and ranking; consumers derive scope from trusted sessions rather than accepting identity fields from model or browser input.

The default consumer queues each completed turn, then uses the conversation's routed model through `ctx.llm` to propose validated upsert, delete, or no-op mutations against relevant candidates. User text is authoritative; the Assistant answer only disambiguates it. After the provider transaction commits, a durable maintenance event records the exact changed item identities. The same consumer calls `recall()` before the first model step of a later session and exposes explicit search, remember, and forget tools. Recalled text is an untrusted `agent-memory`-sourced `user/message`, so the ordinary session projection records exactly what the model received and the browser can offer exact-item correction.

The shipped single-user desktop provider keeps controls in Settings and data in owner-only SQLite. Secret-like input is rejected before the durable outbox or extraction call; `(session, turn)` makes queued capture idempotent; `workspace + kind + semantic key` makes corrections replace old values. Events expire, failed extraction is retried within configured bounds, and lexical/keyword recall combines overlap, confidence, and recency. Low-emphasis conversation rows expose committed maintenance and recall provenance; their editor and the shell-independent Settings section use a dedicated loopback-only privileged API for list, update, delete, and clear without receiving the database path. A shared Host must replace this provider with one scoped by authenticated employee identity.

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

Source: [`packages/memory/agent-memory/src/index.ts:179`](../../packages/memory/agent-memory/src/index.ts)
<!-- END GENERATED cordis-surface -->
