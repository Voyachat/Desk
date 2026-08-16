import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ManagedRuntime, type RuntimeChild, type RuntimeSpawn } from '../src/runtime-process.js'

const MODEL_CREDENTIAL_ENVIRONMENT = {
  GEMINI_API_KEY: 'test-gemini-credential',
  DASHSCOPE_API_KEY: 'test-dashscope-credential',
} as const

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly killedWith: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedWith.push(signal)
    return true
  }
}

function fakeSpawn(child: FakeChild, calls: unknown[][]): RuntimeSpawn {
  return ((executable, args, options) => {
    calls.push([executable, args, options])
    return child as unknown as RuntimeChild
  }) as RuntimeSpawn
}

describe('managed DSH runtime', () => {
  it('passes model credentials only through the child environment and awaits shutdown', async () => {
    const child = new FakeChild()
    const calls: unknown[][] = []
    const onLog = vi.fn()
    const runtime = new ManagedRuntime({
      executable: '/Applications/Voyaseek.app/Contents/MacOS/Voyaseek',
      entry: '/Applications/Voyaseek.app/Contents/Resources/runtime/apps/cli/lib/bin.js',
      dshHome: '/tmp/aistaff-home',
      cwd: '/tmp/aistaff-workspace',
      credentialEnvironment: MODEL_CREDENTIAL_ENVIRONMENT,
      networkEnvironment: {
        HTTPS_PROXY: 'http://system-proxy.example:8080',
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: '127.0.0.1,localhost',
      },
      onLog,
    }, fakeSpawn(child, calls))

    const started = runtime.start()
    child.stderr.write('DSH runtime starting\n')
    child.stdout.write('dsh web: http://127.0.0.1:53100\n')
    await expect(started).resolves.toMatchObject({ href: 'http://127.0.0.1:53100/' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe('/Applications/Voyaseek.app/Contents/MacOS/Voyaseek')
    expect(calls[0]?.[1]).toEqual([
      '--expose-internals',
      '/Applications/Voyaseek.app/Contents/Resources/runtime/apps/cli/lib/bin.js',
      '--profile', 'aistaff', '--port', '0',
    ])
    expect(calls[0]?.[2]).toMatchObject({
      cwd: '/tmp/aistaff-workspace',
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: '/tmp/aistaff-home',
        DSH_CWD: '/tmp/aistaff-workspace',
        GEMINI_API_KEY: 'test-gemini-credential',
        DASHSCOPE_API_KEY: 'test-dashscope-credential',
        HTTPS_PROXY: 'http://system-proxy.example:8080',
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: '127.0.0.1,localhost',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(onLog).toHaveBeenCalledWith('DSH runtime starting\n')
    for (const [name, value] of Object.entries(MODEL_CREDENTIAL_ENVIRONMENT)) {
      expect(JSON.stringify(calls[0]?.[1])).not.toContain(name)
      expect(JSON.stringify(calls[0]?.[1])).not.toContain(value)
      expect(JSON.stringify(onLog.mock.calls)).not.toContain(name)
      expect(JSON.stringify(onLog.mock.calls)).not.toContain(value)
    }

    const stopped = runtime.stop()
    expect(child.killedWith).toEqual(['SIGTERM'])
    child.emit('exit', 0, null)
    await stopped
  })

  it('rejects an exit before readiness', async () => {
    const child = new FakeChild()
    const runtime = new ManagedRuntime({
      executable: '/electron',
      entry: '/runtime/apps/cli/lib/bin.js',
      dshHome: '/home',
      cwd: '/workspace',
      credentialEnvironment: MODEL_CREDENTIAL_ENVIRONMENT,
    }, fakeSpawn(child, []))
    const started = runtime.start()
    child.emit('exit', 2, null)
    const error = await started.catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('code=2')
    for (const [name, value] of Object.entries(MODEL_CREDENTIAL_ENVIRONMENT)) {
      expect(String(error)).not.toContain(name)
      expect(String(error)).not.toContain(value)
    }
  })

  it('reports an unexpected exit after readiness', async () => {
    const child = new FakeChild()
    const onUnexpectedExit = vi.fn()
    const runtime = new ManagedRuntime({
      executable: '/electron',
      entry: '/runtime/apps/cli/lib/bin.js',
      dshHome: '/home',
      cwd: '/workspace',
      credentialEnvironment: MODEL_CREDENTIAL_ENVIRONMENT,
      onUnexpectedExit,
    }, fakeSpawn(child, []))
    const started = runtime.start()
    child.stdout.write('dsh web: http://127.0.0.1:53101\n')
    await started
    child.emit('exit', 1, null)
    expect(onUnexpectedExit).toHaveBeenCalledWith('DSH runtime exited (code=1, signal=null)')
    for (const [name, value] of Object.entries(MODEL_CREDENTIAL_ENVIRONMENT)) {
      expect(JSON.stringify(onUnexpectedExit.mock.calls)).not.toContain(name)
      expect(JSON.stringify(onUnexpectedExit.mock.calls)).not.toContain(value)
    }
  })
})
