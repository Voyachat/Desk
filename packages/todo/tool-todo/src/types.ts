/**
 * Pure types of the todo domain: the ONE home of the `todos` projection-key
 * declaration plus its payload types, free of this package's host-side value
 * imports (dsh-tools, zod). Two namespace projections serve it — `./types`
 * for host consumers, `./client/types` (the browser half-entry's re-export)
 * for client aggregates — with zero content duplication.
 *
 * @module @voyaseek-ai/dsh-tool-todo/types
 */

import type { TodoItem } from '@voyaseek-ai/dsh-session/types'

export type { TodoItem } from '@voyaseek-ai/dsh-session/types'

/** UI projection status: model-authored lifecycle plus terminal turn failure. */
export type TodoProjectionStatus = TodoItem['status'] | 'failed' | 'blocked'

/** One task as exposed by the session projection read side. */
export interface TodoProjectionItem {
  /** Model-authored task text. */
  readonly content: string
  /** Model-authored state, or a terminal failure/block after the turn errors. */
  readonly status: TodoProjectionStatus
}

declare module '@voyaseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The agent's current whole todo list (the latest `todo/write` snapshot),
     * or `null` before the first write. Pending and in-progress entries become
     * terminal when their owning turn ends in error: active work becomes
     * `failed`, while work not yet started becomes `blocked`. Completed
     * entries remain completed. A later `turn/start` clears the standing list.
     */
    todos: TodoProjectionItem[] | null
  }
}
