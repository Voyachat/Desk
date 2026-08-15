import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  CapabilityContextHandle,
  SupervisorActivityRef,
  SupervisorControlError,
  SupervisorDshSessionId,
  SupervisorGrantHandle,
  SupervisorGrantRevision,
  SupervisorOperationId,
  SupervisorReceiptRef,
  SupervisorRuntimeHandle,
  type ReadCapabilityRequest,
  type SupervisorGrantRegister,
  type SupervisorSubjectBinding,
} from '@deepseek-ai/dsh-aistaff-supervisor-control'
import * as SupervisorProcessPlugin from '@deepseek-ai/dsh-aistaff-supervisor-process'
import * as SupervisorControlProcessPlugin from '../src/index.ts'

const roots: string[] = []
const fibers: { dispose(): Promise<void> }[] = []

afterEach(async () => {
  for (const fiber of fibers.splice(0).reverse()) await fiber.dispose()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function subject(): SupervisorSubjectBinding {
  return {
    kind: 'local',
    activity_ref: SupervisorActivityRef('activity-1'),
    dsh_session_id: SupervisorDshSessionId('session-1'),
  }
}

function future(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString()
}

function registration(operationId = 'register-1'): SupervisorGrantRegister {
  return {
    operation_id: SupervisorOperationId(operationId),
    subject: subject(),
    root_path: resolve(tmpdir(), 'private-customer-root'),
    display_name: '客户资料',
    access: 'read_only',
    allowed_intents: ['file/read_text', 'directory/list'],
    expires_at: future(60_000),
  }
}

function readRequest(
  operationId: string,
  intent: 'file/read_text' | 'directory/list',
  maxBytes = 1024,
): ReadCapabilityRequest {
  return {
    operation_id: SupervisorOperationId(operationId),
    execution_context: {
      kind: 'capability_only',
      capability_context_handle: CapabilityContextHandle('context-1'),
    },
    subject: subject(),
    grant_handle: SupervisorGrantHandle('grant-1'),
    expected_grant_revision: SupervisorGrantRevision('revision-1'),
    intent,
    relative_segments: intent === 'directory/list' ? [] : ['notes.txt'],
    max_bytes: maxBytes,
    deadline_at: future(30_000),
  }
}

async function setup(mode = 'normal', requestTimeoutMs = 2_000): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'aidesktop-control-process-'))
  roots.push(root)
  const fixture = resolve(import.meta.dirname, 'fake-supervisor.mjs')
  const binary = join(root, 'supervisor')
  await writeFile(binary, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}\n`, 'utf8')
  await chmod(binary, 0o700)
  await writeFile(join(root, 'mode'), mode, 'utf8')
  const ctx = new Context()
  const processFiber = await ctx.plugin(SupervisorProcessPlugin, {
    binaryPath: binary,
    workingDirectory: root,
    requestTimeoutMs,
    shutdownTimeoutMs: 100,
  })
  fibers.push(processFiber)
  const controlFiber = await ctx.plugin(SupervisorControlProcessPlugin)
  fibers.push(controlFiber)
  return ctx
}

function containsPrivateCarrierValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('private-customer-root') || value.startsWith('file:')
      || value.includes('AISTAFF_SUPERVISOR_TOKEN')
  }
  if (value === null || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) =>
    /(?:root_path|url|auth_token|socket|endpoint)/i.test(key) || containsPrivateCarrierValue(child))
}

describe('Rust SupervisorControl process provider', () => {
  test('loads only after the strict control handshake and returns its authoritative limits', async () => {
    const ctx = await setup()
    const hello = await ctx.aistaffSupervisorControl.hello()
    expect(hello).toEqual({
      control_version: 'aidesktop.supervisor-control.v1',
      supervisor_version: '0.1.0-test',
      supported_control_versions: ['aidesktop.supervisor-control.v1'],
      platform: 'test',
      architecture: 'test',
      capabilities: ['file/read_text', 'directory/list'],
      max_request_bytes: 65536,
      max_result_bytes: 24576,
      capability_context_handle: 'context-1',
    })
    expect(ctx.aistaffSupervisorControl).toBeInstanceOf(SupervisorControlProcessPlugin.SupervisorControlProcessPort)
    expect(containsPrivateCarrierValue(hello)).toBe(false)
  })

  test.each(['bad-version', 'bad-capabilities', 'bad-capability-order', 'bad-limits'])(
    'fails plugin loading for %s hello',
    async mode => {
    const root = await mkdtemp(join(tmpdir(), 'aidesktop-control-process-'))
    roots.push(root)
    const fixture = resolve(import.meta.dirname, 'fake-supervisor.mjs')
    const binary = join(root, 'supervisor')
    await writeFile(binary, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}\n`, 'utf8')
    await chmod(binary, 0o700)
    await writeFile(join(root, 'mode'), mode, 'utf8')
    const ctx = new Context()
    const processFiber = await ctx.plugin(SupervisorProcessPlugin, {
      binaryPath: binary,
      workingDirectory: root,
      requestTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
    })
    fibers.push(processFiber)
    await expect(ctx.plugin(SupervisorControlProcessPlugin)).rejects.toMatchObject({
      code: 'RUNTIME_VERSION_MISMATCH',
    })
      expect(ctx.get('aistaffSupervisorControl')).toBeUndefined()
    },
  )

  test('forwards Grant, Receipt, revoke, and operation reconciliation without manufacturing identities', async () => {
    const ctx = await setup()
    const registered = await ctx.aistaffSupervisorControl.registerGrant(registration())
    expect(registered).toMatchObject({
      grant: {
        grant_handle: 'grant-1',
        grant_revision: 'revision-1',
        allowed_intents: ['file/read_text', 'directory/list'],
      },
      receipt: {
        receipt_ref: 'receipt-register-1',
        operation_id: 'register-1',
      },
    })
    const revoked = await ctx.aistaffSupervisorControl.revokeGrant({
      operation_id: SupervisorOperationId('revoke-1'),
      grant_handle: registered.grant.grant_handle,
      expected_grant_revision: registered.grant.grant_revision,
    })
    expect(revoked).toMatchObject({
      receipt_ref: 'receipt-revoke-1',
      operation_id: 'revoke-1',
      effect_state: 'not_applied',
    })
    expect(await ctx.aistaffSupervisorControl.getReceipt({
      receipt_ref: SupervisorReceiptRef('receipt-read-file'),
    })).toMatchObject({ receipt_ref: 'receipt-read-file', operation_id: 'read-file' })
    expect(await ctx.aistaffSupervisorControl.readOperation({
      operation_id: SupervisorOperationId('read-file'),
    })).toEqual({
      operation_id: 'read-file',
      state: 'succeeded',
      receipt_ref: 'receipt-read-file',
      updated_at: '2026-08-15T00:00:00.000Z',
    })
    expect(containsPrivateCarrierValue(registered)).toBe(false)
  })

  test('rejects a path-bearing opaque response without copying it into the public error', async () => {
    const ctx = await setup()
    let failure: unknown
    try {
      await ctx.aistaffSupervisorControl.registerGrant(registration('bad-response-path'))
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'OUTCOME_UNKNOWN', operation_id: 'bad-response-path' })
    expect(JSON.stringify(failure)).not.toContain('/private/customer')
  })

  test('decodes bounded file bytes and maps direct directory entries', async () => {
    const ctx = await setup()
    const file = await ctx.aistaffSupervisorControl.readCapability(readRequest('read-file', 'file/read_text'))
    expect(file.payload.kind).toBe('file')
    if (file.payload.kind !== 'file') throw new TypeError('Expected file payload')
    expect(new TextDecoder().decode(file.payload.bytes)).toBe('hello from rust')
    expect(file.payload.media_type).toBe('text/plain; charset=utf-8')

    const directory = await ctx.aistaffSupervisorControl.readCapability(readRequest('read-directory', 'directory/list'))
    expect(directory.payload).toEqual({
      kind: 'directory',
      entries: [
        { name: 'notes.txt', kind: 'file', size_bytes: 15 },
        { name: 'archive', kind: 'directory' },
      ],
    })
    expect(containsPrivateCarrierValue([file, directory])).toBe(false)
  })

  test('maps stable Rust failures and hides unknown remote codes', async () => {
    const ctx = await setup()
    await expect(ctx.aistaffSupervisorControl.readCapability(
      readRequest('remote-conflict', 'file/read_text'),
    )).rejects.toMatchObject({ code: 'OPERATION_CONFLICT', operation_id: 'remote-conflict' })
    await expect(ctx.aistaffSupervisorControl.readCapability(
      readRequest('remote-unknown', 'file/read_text'),
    )).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', operation_id: 'remote-unknown' })
    let failure: unknown
    try {
      await ctx.aistaffSupervisorControl.readCapability(readRequest('unknown-remote-code', 'file/read_text'))
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'SUPERVISOR_UNAVAILABLE' })
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_LOCAL_PATH_FAILURE')
  })

  test('preserves the original operation identity when the carrier times out', async () => {
    const ctx = await setup()
    await expect(ctx.aistaffSupervisorControl.readCapability(
      readRequest('timeout-read', 'file/read_text'),
    )).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN', operation_id: 'timeout-read' })
  })

  test.each([
    ['bad-base64', 'file/read_text'],
    ['oversized-file', 'file/read_text'],
    ['bad-metadata', 'file/read_text'],
    ['bad-directory', 'directory/list'],
  ] as const)(
    'fails closed on invalid %s read output without returning private fields',
    async (operationId, intent) => {
      const ctx = await setup()
      let failure: unknown
      try {
        await ctx.aistaffSupervisorControl.readCapability(readRequest(operationId, intent, 16))
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(SupervisorControlError)
      expect(failure).toMatchObject({ code: 'OUTCOME_UNKNOWN', operation_id: operationId })
      expect(containsPrivateCarrierValue(failure)).toBe(false)
    },
  )

  test('rejects managed runtime, legacy intents, traversal, expired deadlines, and extra fields before dispatch', async () => {
    const ctx = await setup()
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('managed-runtime', 'file/read_text'),
      execution_context: { kind: 'managed_runtime', runtime_handle: SupervisorRuntimeHandle('runtime-1') },
    })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED', operation_id: 'managed-runtime' })
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('legacy-intent', 'file/read_text'),
      intent: 'read_file',
    })).rejects.toMatchObject({ code: 'CAPABILITY_DENIED', operation_id: 'legacy-intent' })
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('traversal', 'file/read_text'),
      relative_segments: ['..'],
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', operation_id: 'traversal' })
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('expired', 'file/read_text'),
      deadline_at: '2026-08-14T00:00:00.000Z',
    })).rejects.toMatchObject({ code: 'DEADLINE_EXPIRED', operation_id: 'expired' })
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('bad-rfc3339', 'file/read_text'),
      deadline_at: '2026-08-15 00:00:00Z',
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', operation_id: 'bad-rfc3339' })
    await expect(ctx.aistaffSupervisorControl.readCapability({
      ...readRequest('over-limit', 'file/read_text'),
      max_bytes: 24_577,
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST', operation_id: 'over-limit' })
    await expect(ctx.aistaffSupervisorControl.registerGrant({
      ...registration('extra-field'),
      token: 'must-not-cross',
    } as SupervisorGrantRegister)).rejects.toMatchObject({ code: 'INVALID_REQUEST', operation_id: 'extra-field' })
  })
})
