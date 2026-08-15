import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CapabilityContextHandle,
  SUPERVISOR_CONTROL_SERVICE_KEY,
  SupervisorActivityRef,
  SupervisorControlError,
  SupervisorDshSessionId,
  SupervisorGrantHandle,
  SupervisorOperationId,
  SupervisorReceiptRef,
} from '../src/index.ts'
import type {
  ReadCapabilityRequest,
  SupervisorGrantRegister,
  SupervisorSubjectBinding,
} from '../src/types.ts'
import { InMemorySupervisorControl } from '../src/testing.ts'

const startedAt = Date.parse('2026-08-15T00:00:00.000Z')
const rootPath = resolve(tmpdir(), 'aistaff-supervisor-secret-root')

function ids(): (kind: string) => string {
  let next = 0
  return kind => `${kind}-${String(++next)}`
}

function subject(activity = 'activity-1'): SupervisorSubjectBinding {
  return {
    kind: 'local',
    activity_ref: SupervisorActivityRef(activity),
    dsh_session_id: SupervisorDshSessionId('session-1'),
  }
}

function registration(operation = 'register-1'): SupervisorGrantRegister {
  return {
    operation_id: SupervisorOperationId(operation),
    subject: subject(),
    root_path: rootPath,
    display_name: '客户资料',
    access: 'read_only',
    allowed_intents: ['directory/list', 'file/read_text'],
    expires_at: '2026-08-15T01:00:00.000Z',
  }
}

async function setup(options: {
  readonly now?: { value: number }
  readonly maxResultBytes?: number
  readonly unknown?: boolean
  readonly fileBytes?: Uint8Array
} = {}): Promise<{ ctx: Context; fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const now = options.now ?? { value: startedAt }
  const ctx = new Context()
  const fiber = await ctx.plugin(InMemorySupervisorControl, {
    clock: () => new Date(now.value),
    nextId: ids(),
    maxResultBytes: options.maxResultBytes ?? 1024,
    intentResults: {
      'directory/list': {
        kind: 'directory',
        entries: [{ name: 'notes.txt', kind: 'file', size_bytes: 5 }],
      },
      'file/read_text': options.unknown
        ? { kind: 'unknown' }
        : { kind: 'file', bytes: options.fileBytes ?? new TextEncoder().encode('hello'), media_type: 'text/plain' },
    },
  })
  return { ctx, fiber }
}

function readRequest(
  context: string,
  grant: Awaited<ReturnType<typeof register>>['grant'],
  overrides: Partial<ReadCapabilityRequest> = {},
): ReadCapabilityRequest {
  return {
    operation_id: SupervisorOperationId('read-1'),
    execution_context: {
      kind: 'capability_only',
      capability_context_handle: CapabilityContextHandle(context),
    },
    subject: subject(),
    grant_handle: grant.grant_handle,
    expected_grant_revision: grant.grant_revision,
    intent: 'directory/list',
    relative_segments: [],
    max_bytes: 512,
    deadline_at: '2026-08-15T00:30:00.000Z',
    ...overrides,
  }
}

async function register(ctx: Context, input = registration()) {
  return ctx.aistaffSupervisorControl.registerGrant(input)
}

function forbidden(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes(rootPath) || value.startsWith('file:')
      || value.includes('socket') || value.includes('token')
  }
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) =>
    /(?:path|socket|token)/i.test(key) || forbidden(child))
}

describe('SupervisorControlPort seam', () => {
  it('registers under the fixed Host-only service key and leaves with its fiber', async () => {
    const { ctx, fiber } = await setup()
    expect(SUPERVISOR_CONTROL_SERVICE_KEY).toBe('aistaffSupervisorControl')
    expect(ctx.get(SUPERVISOR_CONTROL_SERVICE_KEY)).toBeInstanceOf(InMemorySupervisorControl)
    await fiber.dispose()
    expect(ctx.get(SUPERVISOR_CONTROL_SERVICE_KEY)).toBeUndefined()
  })

  it('returns a bounded path-free hello with the current opaque capability context', async () => {
    const { ctx } = await setup()
    const hello = await ctx.aistaffSupervisorControl.hello()
    expect(hello).toMatchObject({
      control_version: 'aidesktop.supervisor-control.v1',
      max_result_bytes: 1024,
    })
    expect(hello.capability_context_handle).toMatch(/^capability-context-/)
    expect(forbidden(hello)).toBe(false)
  })
})

describe('in-memory Grant lifecycle and idempotency', () => {
  it('replays an identical registration and rejects operation-id input conflicts', async () => {
    const { ctx } = await setup()
    const first = await register(ctx)
    const replay = await register(ctx)
    expect(replay).toBe(first)
    expect(forbidden(first)).toBe(false)

    await expect(register(ctx, { ...registration(), display_name: '另一目录' }))
      .rejects.toMatchObject({ code: 'OPERATION_CONFLICT' })
  })

  it('checks Grant revision, revoke state, expiry, and exact subject before reading', async () => {
    const now = { value: startedAt }
    const { ctx } = await setup({ now })
    const { grant } = await register(ctx)
    const context = (await ctx.aistaffSupervisorControl.hello()).capability_context_handle

    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, grant, {
      expected_grant_revision: 'wrong-revision' as typeof grant.grant_revision,
    }))).rejects.toMatchObject({ code: 'GRANT_REVISION_MISMATCH' })

    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, grant, {
      operation_id: SupervisorOperationId('wrong-subject'),
      subject: subject('activity-2'),
    }))).rejects.toMatchObject({ code: 'GRANT_SCOPE_MISMATCH' })

    const revoked = await ctx.aistaffSupervisorControl.revokeGrant({
      operation_id: SupervisorOperationId('revoke-1'),
      grant_handle: grant.grant_handle,
      expected_grant_revision: grant.grant_revision,
    })
    expect((await ctx.aistaffSupervisorControl.getReceipt({ receipt_ref: revoked.receipt_ref }))).toBe(revoked)
    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, grant, {
      operation_id: SupervisorOperationId('after-revoke'),
    }))).rejects.toMatchObject({ code: 'GRANT_NOT_ACTIVE' })

    const second = await register(ctx, { ...registration('register-2'), expires_at: '2026-08-15T00:05:00.000Z' })
    now.value = Date.parse('2026-08-15T00:06:00.000Z')
    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, second.grant, {
      operation_id: SupervisorOperationId('expired-read'),
    }))).rejects.toMatchObject({ code: 'GRANT_NOT_ACTIVE' })
  })
})

describe('bounded read result and reconciliation', () => {
  it('returns a path-free payload, replays it, and retains operation and Receipt state', async () => {
    const { ctx } = await setup()
    const { grant } = await register(ctx)
    const context = (await ctx.aistaffSupervisorControl.hello()).capability_context_handle
    const input = readRequest(context, grant)
    const first = await ctx.aistaffSupervisorControl.readCapability(input)
    const replay = await ctx.aistaffSupervisorControl.readCapability(input)
    expect(replay).toBe(first)
    expect(forbidden(first)).toBe(false)
    expect(await ctx.aistaffSupervisorControl.readOperation({ operation_id: input.operation_id }))
      .toMatchObject({ state: 'succeeded', receipt_ref: first.receipt.receipt_ref })
    expect(await ctx.aistaffSupervisorControl.getReceipt({ receipt_ref: first.receipt.receipt_ref })).toBe(first.receipt)
  })

  it('rejects oversized payloads and non-relative segments before returning content', async () => {
    const { ctx } = await setup({ fileBytes: new Uint8Array(20), maxResultBytes: 16 })
    const { grant } = await register(ctx)
    const context = (await ctx.aistaffSupervisorControl.hello()).capability_context_handle
    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, grant, {
      intent: 'file/read_text', max_bytes: 16,
    }))).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' })
    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest(context, grant, {
      operation_id: SupervisorOperationId('traversal'), relative_segments: ['..'],
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('retains an unknown Receipt and requires reconciliation with the original operation id', async () => {
    const { ctx } = await setup({ unknown: true })
    const { grant } = await register(ctx)
    const context = (await ctx.aistaffSupervisorControl.hello()).capability_context_handle
    const input = readRequest(context, grant, { intent: 'file/read_text' })
    let failure: SupervisorControlError | undefined
    try {
      await ctx.aistaffSupervisorControl.readCapability(input)
    } catch (error) {
      failure = error as SupervisorControlError
    }
    expect(failure).toMatchObject({ code: 'OUTCOME_UNKNOWN', operation_id: input.operation_id })
    const receiptRef = failure?.receipt_ref ?? SupervisorReceiptRef('missing')
    expect(await ctx.aistaffSupervisorControl.getReceipt({ receipt_ref: receiptRef }))
      .toMatchObject({ status: 'unknown', effect_state: 'unknown' })
    expect(await ctx.aistaffSupervisorControl.readOperation({ operation_id: input.operation_id }))
      .toMatchObject({ state: 'unknown', receipt_ref: receiptRef })
    await expect(ctx.aistaffSupervisorControl.readCapability(input))
      .rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', receipt_ref: receiptRef })
  })

  it('rejects an unknown capability context without consuming a result', async () => {
    const { ctx } = await setup()
    const { grant } = await register(ctx)
    await expect(ctx.aistaffSupervisorControl.readCapability(readRequest('foreign-context', grant)))
      .rejects.toMatchObject({ code: 'CAPABILITY_DENIED' })
    await expect(ctx.aistaffSupervisorControl.getReceipt({ receipt_ref: SupervisorReceiptRef('missing') }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(ctx.aistaffSupervisorControl.readOperation({ operation_id: SupervisorOperationId('missing') }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(SupervisorGrantHandle('opaque')).toBe('opaque')
  })
})
