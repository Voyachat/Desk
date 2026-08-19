/** Zod schemas for the loopback-only memory management domain. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { MemoryEntryView } from './memory.ts'

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

export const memoryListRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'memory.list'>>>
export const memoryListValueSchema = z.object({
  entries: z.array(memoryEntryViewSchema), pendingCount: z.number(), failedCount: z.number(), maxEntries: z.number(),
}) satisfies z.ZodType<Wire<ResponseValue<'memory.list'>>>

export const memoryForgetRequestSchema = z.object({
  ids: z.array(z.string().min(1)).max(1_000),
}) satisfies z.ZodType<Wire<RequestPayload<'memory.forget'>>>
export const memoryForgetValueSchema = z.object({ deleted: z.number() }) satisfies z.ZodType<Wire<ResponseValue<'memory.forget'>>>

export const memoryClearRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'memory.clear'>>>
export const memoryClearValueSchema = z.object({ deleted: z.number() }) satisfies z.ZodType<Wire<ResponseValue<'memory.clear'>>>
