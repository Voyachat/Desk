/** Zod schemas for the loopback-only memory management domain. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { MemoryEntryView } from './memory.ts'

/** Wire schema for one projected long-term memory entry. */
export const memoryEntryViewSchema = z.object({
  id: z.string().min(1),
  kind: z.union([z.literal('preference'), z.literal('fact'), z.literal('constraint'), z.literal('event')]),
  key: z.string(), title: z.string(), content: z.string(), keywords: z.array(z.string()),
  confidence: z.number(), createdAt: z.number(), updatedAt: z.number(),
  expiresAt: z.number().optional(), workspace: z.string().optional(),
  source: z.object({
    sessionId: z.string().min(1), turn: z.number(),
    mode: z.union([z.literal('automatic'), z.literal('explicit')]),
  }),
}) satisfies z.ZodType<Wire<MemoryEntryView>>

/** Empty request schema for listing long-term memories. */
export const memoryListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'memory.list'>>>
/** Response schema for the bounded memory list and queue counters. */
export const memoryListValueSchema = z.object({
  entries: z.array(memoryEntryViewSchema), pendingCount: z.number(), failedCount: z.number(), maxEntries: z.number(),
}) satisfies z.ZodType<Wire<ResponseValue<'memory.list'>>>

/** Request schema for replacing one memory's user-editable fields. */
export const memoryUpdateRequestSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(2_000),
  keywords: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'memory.update'>>>
/** Response schema carrying the updated memory projection. */
export const memoryUpdateValueSchema = z.object({ entry: memoryEntryViewSchema }) satisfies z.ZodType<Wire<ResponseValue<'memory.update'>>>

/** Request schema for deleting a bounded set of memory identities. */
export const memoryForgetRequestSchema = z.object({
  ids: z.array(z.string().min(1)).max(1_000),
}) satisfies z.ZodType<Wire<RequestPayload<'memory.forget'>>>
/** Response schema reporting the number of deleted memories. */
export const memoryForgetValueSchema = z.object({ deleted: z.number() }) satisfies z.ZodType<Wire<ResponseValue<'memory.forget'>>>

/** Empty request schema for clearing memory and pending captures. */
export const memoryClearRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'memory.clear'>>>
/** Response schema reporting the number of cleared memories. */
export const memoryClearValueSchema = z.object({ deleted: z.number() }) satisfies z.ZodType<Wire<ResponseValue<'memory.clear'>>>
