import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STARTUP_CHANNELS } from '../src/startup-ipc.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop main lifecycle', () => {
  it('loads and shows the startup page before runtime readiness settles', async () => {
    const runtimeReady = deferred<URL>()
    const firstRuntime = { start: vi.fn(() => runtimeReady.promise), stop: vi.fn(async () => undefined) }
    const harness = installMainHarness([firstRuntime])

    await import('../src/main.js')

    await vi.waitFor(() => { expect(harness.window.loadFile).toHaveBeenCalledOnce() })
    expect(harness.window.show).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(firstRuntime.start).toHaveBeenCalledOnce() })
    expect(harness.window.loadURL).not.toHaveBeenCalled()

    runtimeReady.resolve(new URL('http://127.0.0.1:53100/'))
    await vi.waitFor(() => {
      expect(harness.window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:53100/')
    })
  })

  it('retains the window and startup intent while retrying a failed launch', async () => {
    const retryReady = deferred<URL>()
    const firstRuntime = {
      start: vi.fn(async () => { throw new Error('first boot failed') }),
      stop: vi.fn(async () => undefined),
    }
    const secondRuntime = { start: vi.fn(() => retryReady.promise), stop: vi.fn(async () => undefined) }
    const harness = installMainHarness([firstRuntime, secondRuntime])

    await import('../src/main.js')
    const event = harness.trustedInvokeEvent()
    const getState = await harness.ipcHandler(STARTUP_CHANNELS.getState)
    const setIntent = await harness.ipcHandler(STARTUP_CHANNELS.setIntent)
    const getIntent = await harness.ipcHandler(STARTUP_CHANNELS.getIntent)
    const acknowledge = await harness.ipcHandler(STARTUP_CHANNELS.acknowledge)
    const retry = await harness.ipcHandler(STARTUP_CHANNELS.retry)

    await vi.waitFor(async () => {
      await expect(getState(event)).resolves.toMatchObject({ phase: 'failed' })
    })
    await expect(setIntent(event, { draft: '保留这段输入', agentPreset: 'code' })).resolves.toEqual({
      draft: '保留这段输入',
      agentPreset: 'code',
    })

    await expect(retry(event)).resolves.toEqual({ phase: 'starting' })
    await vi.waitFor(() => { expect(secondRuntime.start).toHaveBeenCalledOnce() })
    await expect(getIntent(event)).resolves.toEqual({ draft: '保留这段输入', agentPreset: 'code' })
    expect(harness.window.destroy).not.toHaveBeenCalled()
    expect(harness.quit).not.toHaveBeenCalled()
    expect(harness.showErrorBox).not.toHaveBeenCalled()

    retryReady.resolve(new URL('http://127.0.0.1:53100/'))
    await vi.waitFor(() => { expect(harness.window.loadURL).toHaveBeenCalledOnce() })
    await expect(acknowledge(event)).resolves.toBeUndefined()
    await expect(getIntent(event)).resolves.toBeNull()
  })

  it('restores the startup page when runtime navigation fails', async () => {
    const navigation = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime], navigation.promise)

    await import('../src/main.js')
    await vi.waitFor(() => { expect(harness.window.loadURL).toHaveBeenCalledOnce() })
    navigation.reject(new Error('runtime navigation failed'))

    await vi.waitFor(() => { expect(harness.window.loadFile).toHaveBeenCalledTimes(2) })
    const getState = await harness.ipcHandler(STARTUP_CHANNELS.getState)
    await expect(getState(harness.trustedInvokeEvent())).resolves.toEqual({
      phase: 'failed',
      message: 'runtime navigation failed',
    })
    expect(harness.window.destroy).not.toHaveBeenCalled()
  })

  it('does not report an intentional shutdown while the runtime document is loading', async () => {
    const runtimeDocument = deferred<undefined>()
    const stopped = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(() => stopped.promise),
    }
    const harness = installMainHarness([firstRuntime], runtimeDocument.promise)

    await import('../src/main.js')
    await vi.waitFor(() => {
      expect(harness.window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:53100/')
    })

    const quitEvent = { preventDefault: vi.fn() }
    harness.emit('before-quit', quitEvent)
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    expect(firstRuntime.stop).toHaveBeenCalledOnce()

    runtimeDocument.reject(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1:53100/'"))
    await vi.waitFor(() => { expect(harness.showErrorBox).not.toHaveBeenCalled() })
    expect(harness.quit).not.toHaveBeenCalled()

    stopped.resolve(undefined)
    await vi.waitFor(() => { expect(harness.quit).toHaveBeenCalledOnce() })
    expect(harness.showErrorBox).not.toHaveBeenCalled()
  })
})

interface RuntimeMock {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function installMainHarness(runtimeMocks: RuntimeMock[], runtimeDocument: Promise<void> = Promise.resolve()): {
  window: {
    webContents: Record<string, unknown>
    loadFile: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  quit: ReturnType<typeof vi.fn>
  showErrorBox: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => void
  ipcHandler: (channel: string) => Promise<(...args: unknown[]) => Promise<unknown>>
  trustedInvokeEvent: () => Record<string, unknown>
} {
  const userData = mkdtempSync(join(tmpdir(), 'aistaff-main-'))
  temporaryDirectories.push(userData)
  const appPath = '/Applications/Voyaseek.app/Contents/Resources/app.asar'
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const quit = vi.fn()
  const showErrorBox = vi.fn()
  const mainFrame = { parent: null, processId: 17, routingId: 23 }
  const webContents = {
    mainFrame,
    send: vi.fn(),
    session: {
      resolveProxy: vi.fn(async () => 'DIRECT'),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  }
  const window = {
    webContents,
    isMinimized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(() => runtimeDocument),
  }
  const app = {
    isPackaged: true,
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = eventHandlers.get(event) ?? []
      handlers.push(handler)
      eventHandlers.set(event, handlers)
    }),
    whenReady: vi.fn(async () => undefined),
    getPath: vi.fn((name: string) => name === 'userData' ? userData : join(userData, 'home')),
    getLocaleCountryCode: vi.fn(() => 'CN'),
    getAppPath: vi.fn(() => appPath),
    isReady: vi.fn(() => true),
    quit,
  }

  vi.doMock('../src/electron-api.js', () => ({
    app,
    BrowserWindow: function BrowserWindow(): typeof window { return window },
    dialog: { showErrorBox },
    ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => { ipcHandlers.set(channel, handler) }) },
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template: unknown) => ({ template })) },
    session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
    shell: { openPath: vi.fn(async () => '') },
  }))
  vi.doMock('../src/model-credentials.js', () => ({ loadModelCredentials: vi.fn(() => ({})) }))
  vi.doMock('../src/profile.js', () => ({ ensureAistaffProfile: vi.fn() }))
  vi.doMock('../src/proxy-environment.js', () => ({ resolveProxyEnvironment: vi.fn(async () => ({})) }))
  vi.doMock('../src/runtime-paths.js', () => ({ resolveRuntimeEntry: vi.fn(() => process.execPath) }))
  vi.doMock('../src/runtime-process.js', () => ({
    ManagedRuntime: function ManagedRuntime(): RuntimeMock {
      const runtime = runtimeMocks.shift()
      if (runtime === undefined) throw new Error('No runtime mock remains')
      return runtime
    },
  }))

  return {
    window,
    quit,
    showErrorBox,
    emit: (event, ...args) => {
      for (const handler of eventHandlers.get(event) ?? []) handler(...args)
    },
    ipcHandler: async (channel) => {
      await vi.waitFor(() => { expect(ipcHandlers.has(channel)).toBe(true) })
      const handler = ipcHandlers.get(channel)
      if (handler === undefined) throw new Error(`Missing IPC handler: ${channel}`)
      return async (...args: unknown[]) => handler(...args)
    },
    trustedInvokeEvent: () => ({
      sender: webContents,
      senderFrame: {
        ...mainFrame,
        url: pathToFileURL(join(appPath, 'assets', 'startup.html')).href,
      },
    }),
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
