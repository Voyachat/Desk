import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop main lifecycle', () => {
  it('keeps the window hidden until navigation and the first rendered frame are both ready', async () => {
    const navigation = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime], navigation.promise)

    await import('../src/main.js')
    await vi.waitFor(() => {
      expect(harness.window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:53100/')
    })

    harness.emitWindow('ready-to-show')
    await Promise.resolve()
    expect(harness.window.show).not.toHaveBeenCalled()

    navigation.resolve(undefined)
    await vi.waitFor(() => { expect(harness.window.show).toHaveBeenCalledOnce() })
  })

  it('does not show after navigation until the first rendered frame is ready', async () => {
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime])

    await import('../src/main.js')
    await vi.waitFor(() => { expect(harness.window.loadURL).toHaveBeenCalledOnce() })
    expect(harness.window.show).not.toHaveBeenCalled()

    harness.emitWindow('ready-to-show')
    await vi.waitFor(() => { expect(harness.window.show).toHaveBeenCalledOnce() })
  })

  it('reports a runtime launch failure without loading a fallback page', async () => {
    const firstRuntime = {
      start: vi.fn(async () => { throw new Error('first boot failed') }),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime])

    await import('../src/main.js')

    await vi.waitFor(() => {
      expect(harness.showErrorBox).toHaveBeenCalledWith('Voyaseek 无法启动', 'first boot failed')
    })
    expect(firstRuntime.stop).toHaveBeenCalledOnce()
    expect(harness.window.loadURL).not.toHaveBeenCalled()
    expect(harness.window.show).not.toHaveBeenCalled()
    expect(harness.quit).toHaveBeenCalledOnce()
  })

  it('reports runtime navigation failure without restoring the removed startup page', async () => {
    const navigation = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime], navigation.promise)

    await import('../src/main.js')
    await vi.waitFor(() => { expect(harness.window.loadURL).toHaveBeenCalledOnce() })
    navigation.reject(new Error('runtime navigation failed'))

    await vi.waitFor(() => {
      expect(harness.showErrorBox).toHaveBeenCalledWith('Voyaseek 无法启动', 'runtime navigation failed')
    })
    expect(firstRuntime.stop).toHaveBeenCalledOnce()
    expect(harness.window.show).not.toHaveBeenCalled()
    expect(harness.window.destroy).not.toHaveBeenCalled()
    expect(harness.quit).toHaveBeenCalledOnce()
  })

  it('times out a stalled home page without allowing late readiness to show the window', async () => {
    vi.useFakeTimers()
    const navigation = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime], navigation.promise)

    await import('../src/main.js')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.window.loadURL).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_000)
    expect(harness.window.webContents.stop).toHaveBeenCalledOnce()
    expect(firstRuntime.stop).toHaveBeenCalledOnce()
    expect(harness.showErrorBox).toHaveBeenCalledWith(
      'Voyaseek 无法启动',
      'Timed out waiting for the Voyaseek home page',
    )
    expect(harness.quit).toHaveBeenCalledOnce()

    navigation.resolve(undefined)
    harness.emitWindow('ready-to-show')
    await vi.advanceTimersByTimeAsync(0)
    expect(harness.window.show).not.toHaveBeenCalled()
  })

  it('reports one failure when the runtime exits while its home page is loading', async () => {
    const navigation = deferred<undefined>()
    const firstRuntime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(async () => undefined),
    }
    const harness = installMainHarness([firstRuntime], navigation.promise)

    await import('../src/main.js')
    await vi.waitFor(() => { expect(harness.runtimeOptions).toHaveLength(1) })
    harness.runtimeOptions[0]?.onUnexpectedExit?.('runtime exited')

    expect(harness.showErrorBox).toHaveBeenCalledWith('Voyaseek 无法启动', 'runtime exited')
    expect(harness.quit).toHaveBeenCalledOnce()

    navigation.reject(new Error('navigation ended after runtime exit'))
    await vi.waitFor(() => { expect(firstRuntime.stop).toHaveBeenCalledOnce() })
    expect(harness.showErrorBox).toHaveBeenCalledOnce()
    expect(harness.quit).toHaveBeenCalledOnce()
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
    harness.emitApp('before-quit', quitEvent)
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    expect(firstRuntime.stop).toHaveBeenCalledOnce()

    runtimeDocument.reject(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1:53100/'"))
    await Promise.resolve()
    expect(harness.showErrorBox).not.toHaveBeenCalled()
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

interface RuntimeOptions {
  readonly onUnexpectedExit?: (message: string) => void
}

function installMainHarness(runtimeMocks: RuntimeMock[], runtimeDocument: Promise<void> = Promise.resolve()): {
  window: {
    webContents: {
      stop: ReturnType<typeof vi.fn>
      [key: string]: unknown
    }
    loadURL: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  }
  quit: ReturnType<typeof vi.fn>
  showErrorBox: ReturnType<typeof vi.fn>
  runtimeOptions: RuntimeOptions[]
  emitApp: (event: string, ...args: unknown[]) => void
  emitWindow: (event: string, ...args: unknown[]) => void
} {
  const userData = mkdtempSync(join(tmpdir(), 'aistaff-main-'))
  temporaryDirectories.push(userData)
  const appPath = '/Applications/Voyaseek.app/Contents/Resources/app.asar'
  const appEventHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const windowEventHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const quit = vi.fn()
  const showErrorBox = vi.fn()
  const runtimeOptions: RuntimeOptions[] = []
  let visible = false
  const webContents = {
    session: {
      resolveProxy: vi.fn(async () => 'DIRECT'),
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    stop: vi.fn(),
  }
  const window = {
    webContents,
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const onceHandler = (...args: unknown[]): void => {
        removeHandler(windowEventHandlers, event, onceHandler)
        handler(...args)
      }
      const handlers = windowEventHandlers.get(event) ?? []
      handlers.push(onceHandler)
      windowEventHandlers.set(event, handlers)
      return window
    }),
    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      removeHandler(windowEventHandlers, event, handler)
      return window
    }),
    show: vi.fn(() => { visible = true }),
    loadURL: vi.fn(() => runtimeDocument),
  }
  const app = {
    isPackaged: true,
    requestSingleInstanceLock: vi.fn(() => true),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = appEventHandlers.get(event) ?? []
      handlers.push(handler)
      appEventHandlers.set(event, handlers)
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
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template: unknown) => ({ template })) },
    session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
    shell: { openPath: vi.fn(async () => '') },
  }))
  vi.doMock('../src/model-credentials.js', () => ({ loadModelCredentials: vi.fn(() => ({})) }))
  vi.doMock('../src/profile.js', () => ({ ensureAistaffProfile: vi.fn() }))
  vi.doMock('../src/proxy-environment.js', () => ({ resolveProxyEnvironment: vi.fn(async () => ({})) }))
  vi.doMock('../src/runtime-paths.js', () => ({ resolveRuntimeEntry: vi.fn(() => process.execPath) }))
  vi.doMock('../src/runtime-process.js', () => ({
    ManagedRuntime: function ManagedRuntime(options: RuntimeOptions): RuntimeMock {
      runtimeOptions.push(options)
      const runtime = runtimeMocks.shift()
      if (runtime === undefined) throw new Error('No runtime mock remains')
      return runtime
    },
  }))

  return {
    window,
    quit,
    showErrorBox,
    runtimeOptions,
    emitApp: (event, ...args) => {
      for (const handler of [...(appEventHandlers.get(event) ?? [])]) handler(...args)
    },
    emitWindow: (event, ...args) => {
      for (const handler of [...(windowEventHandlers.get(event) ?? [])]) handler(...args)
    },
  }
}

function removeHandler(
  handlers: Map<string, Array<(...args: unknown[]) => void>>,
  event: string,
  handler: (...args: unknown[]) => void,
): void {
  const remaining = (handlers.get(event) ?? []).filter(candidate => candidate !== handler)
  if (remaining.length === 0) handlers.delete(event)
  else handlers.set(event, remaining)
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
