import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import * as SupervisorProcessPlugin from '../src/index.ts'
import {
  SUPERVISOR_PROCESS_SERVICE_KEY,
  SupervisorProcessController,
  SupervisorProcessError,
  type SupervisorJsonObject,
  type SupervisorProcessCommand,
} from '../src/index.ts'

const BINARY_PATH = resolve(
  process.cwd(),
  'native/aistaff-desktop-supervisor/target/debug/aistaff-desktop-supervisor',
)
const roots: string[] = []
const controllers: SupervisorProcessController[] = []

afterEach(async () => {
  await Promise.all(controllers.splice(0).map(async (controller) => controller.stop()))
  await Promise.all(roots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })))
})

async function runningController(root: string): Promise<SupervisorProcessController> {
  const controller = new SupervisorProcessController({
    binaryPath: BINARY_PATH,
    workingDirectory: root,
    requestTimeoutMs: 2_000,
    shutdownTimeoutMs: 1_000,
  })
  controllers.push(controller)
  await controller.start()
  return controller
}

async function fakeSupervisor(mode: 'timeout' | 'eof' | 'request-id' | 'oversized'): Promise<{
  readonly controller: SupervisorProcessController
  readonly root: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'aidesktop-supervisor-process-fake-'))
  roots.push(root)
  const binaryPath = resolve(import.meta.dirname, 'fake-supervisor.sh')
  await writeFile(join(root, 'mode'), mode, 'utf8')
  await chmod(binaryPath, 0o700)
  const controller = new SupervisorProcessController({
    binaryPath,
    workingDirectory: root,
    requestTimeoutMs: 500,
    shutdownTimeoutMs: 100,
  })
  controllers.push(controller)
  await controller.start()
  return { controller, root }
}

describe.runIf(existsSync(BINARY_PATH))('real Rust Supervisor process', () => {
  test('authenticates hello, admits a path, fails closed on production read, revokes, and joins', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aidesktop-supervisor-process-'))
    roots.push(root)
    const content = '你好，AiDesktop。'
    await writeFile(join(root, 'note.txt'), content, 'utf8')
    const controller = await runningController(root)
    const hello = controller.hello()
    expect(hello.authentication).toBe('per_launch_token')
    expect(hello.capabilities).toContain('local_capability_broker.v1')
    expect(JSON.stringify(hello)).not.toContain(root)

    const grantHandle = randomUUID()
    const grantRevision = randomUUID()
    const scope = { tenant_id: 'local-tenant', session_id: 'local-session', run_id: 'local-run' }
    const grant = await controller.invoke('capability.file.grant.register', {
      protocol_version: 'aistaff.local-capability.v1',
      operation_id: randomUUID(),
      grant_handle: grantHandle,
      grant_revision: grantRevision,
      scope,
      root_path: root,
      access: 'read_only',
      allowed_intents: ['read_file'],
      source: 'system_directory_picker',
      expires_at_ms: Date.now() + 60_000,
    })
    expect(grant).toMatchObject({ grant_status: 'registered', grant_handle: grantHandle })
    expect(JSON.stringify(grant)).not.toContain(root)

    const readOperation = randomUUID()
    const pathRequest: SupervisorJsonObject = {
      protocol_version: 'aistaff.local-capability.v1',
      operation_id: readOperation,
      grant_handle: grantHandle,
      expected_grant_revision: grantRevision,
      scope,
      intent: 'read_file',
      relative_segments: ['note.txt'],
      max_bytes: Buffer.byteLength(content, 'utf8'),
    }
    const admission = await controller.invoke('capability.file.path.admit', pathRequest)
    expect(admission).toMatchObject({
      admission_status: 'validated_no_execution',
      target_kind: 'file',
      size_bytes: Buffer.byteLength(content, 'utf8'),
    })
    expect(JSON.stringify(admission)).not.toContain(root)

    const descriptor = admission.target_descriptor_hash
    if (typeof descriptor !== 'string') {
      throw new TypeError('Supervisor path admission did not return a descriptor hash')
    }
    const read = controller.invoke('capability.file.read', {
      protocol_version: 'aistaff.local-capability.v1',
      capability_request: {
        protocol_version: 'aistaff.local-capability.v1',
        scope,
        authorization: {
          tenant_id: scope.tenant_id,
          source_decision_id: 'decision-1',
          outcome: 'allow',
          action_id: 'file.read',
          capability_id: 'local_file_read.v1',
          resource_revision: grantRevision,
          policy_revision: 'policy-1',
          audit_ref: 'audit-1',
          expires_at_ms: Date.now() + 30_000,
        },
        artifact: {
          artifact_id: 'file-read',
          artifact_version: '1',
          artifact_sha256: 'a'.repeat(64),
          admission_status: 'verified',
        },
        operation: {
          operation_id: readOperation,
          idempotency_key: randomUUID(),
          action_id: 'file.read',
          capability_id: 'local_file_read.v1',
          expected_revision: grantRevision,
          adapter_kind: 'file',
          side_effect: 'read_only',
          risk_level: 'low',
          descriptor_hash: descriptor,
          confirmation: 'not_required',
        },
      },
      path_request: pathRequest,
      expected_target_descriptor_hash: descriptor,
    })
    await expect(read).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      remote_code: 'LOCAL_FILE_PRODUCTION_EXECUTION_DISABLED',
    })

    const revoked = await controller.invoke('capability.file.grant.revoke', {
      protocol_version: 'aistaff.local-capability.v1',
      operation_id: randomUUID(),
      grant_handle: grantHandle,
      expected_grant_revision: grantRevision,
    })
    expect(revoked).toMatchObject({ revoke_status: 'revoked', grant_handle: grantHandle })
    expect(JSON.stringify(revoked)).not.toContain(root)

    await expect(
      controller.invoke('capability.process.execute' as SupervisorProcessCommand),
    ).rejects.toMatchObject({ code: 'COMMAND_DENIED' })
    await expect(controller.health()).resolves.toMatchObject({ status: 'ok' })
    await controller.stop()
    await expect(controller.join()).resolves.toBeUndefined()
  })

  test('rejects oversized UTF-8 requests before writing them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aidesktop-supervisor-process-'))
    roots.push(root)
    const controller = await runningController(root)
    const oversized = '界'.repeat(24_000)
    await expect(
      controller.invoke('capability.file.path.admit', { value: oversized }),
    ).rejects.toBeInstanceOf(SupervisorProcessError)
    await expect(
      controller.invoke('capability.file.path.admit', { value: oversized }),
    ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' })
    await expect(controller.health()).resolves.toMatchObject({ status: 'ok' })
  })

  test('Cordis disposal authenticates shutdown and joins before removing the service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aidesktop-supervisor-process-'))
    roots.push(root)
    const ctx = new Context()
    const fiber = await ctx.plugin(SupervisorProcessPlugin, {
      binaryPath: BINARY_PATH,
      workingDirectory: root,
      requestTimeoutMs: 2_000,
      shutdownTimeoutMs: 1_000,
    })
    const service = ctx.get(SUPERVISOR_PROCESS_SERVICE_KEY)
    if (!(service instanceof SupervisorProcessPlugin.SupervisorProcessService)) {
      throw new Error('Supervisor process service was not published.')
    }
    expect((await service.health()).status).toBe('ok')
    await fiber.dispose()
    await expect(service.join()).resolves.toBeUndefined()
    expect(ctx.get(SUPERVISOR_PROCESS_SERVICE_KEY) === undefined).toBe(true)
  })
})

describe('fail-closed JSONL transport', () => {
  test('joins an authenticated child when service publication fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'aidesktop-supervisor-process-publication-'))
    roots.push(root)
    const binaryPath = resolve(import.meta.dirname, 'fake-supervisor.sh')
    await writeFile(join(root, 'mode'), 'timeout', 'utf8')
    await chmod(binaryPath, 0o700)
    const ctx = new Context()
    ctx.provide(SUPERVISOR_PROCESS_SERVICE_KEY, {})

    await expect(SupervisorProcessPlugin.apply(ctx, {
      binaryPath,
      workingDirectory: root,
      requestTimeoutMs: 2_000,
      shutdownTimeoutMs: 100,
    })).rejects.toThrow(`service "${SUPERVISOR_PROCESS_SERVICE_KEY}" has been registered`)

    const pid = Number.parseInt(await readFile(join(root, 'pid'), 'utf8'), 10)
    expect(() => process.kill(pid, 0)).toThrow()
  })

  test.each([
    ['timeout', 'REQUEST_TIMEOUT'],
    ['eof', 'SUPERVISOR_UNAVAILABLE'],
    ['request-id', 'PROTOCOL_ERROR'],
    ['oversized', 'RESPONSE_TOO_LARGE'],
  ] as const)('maps %s failure to a safe structured error', async (mode, code) => {
    const { controller, root } = await fakeSupervisor(mode)
    let failure: unknown
    try {
      await controller.health()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(SupervisorProcessError)
    expect(failure).toMatchObject({ code })
    expect(JSON.stringify(failure)).not.toContain(root)
    expect(JSON.stringify(failure)).not.toContain('AISTAFF_SUPERVISOR_TOKEN')
    await expect(controller.join()).resolves.toBeUndefined()
  })
})
