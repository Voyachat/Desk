import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const temporaryDirectories: string[] = []

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('desktop main lifecycle', () => {
  it('does not report an intentional shutdown while the runtime document is loading', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'aistaff-main-'))
    temporaryDirectories.push(userData)
    const load = deferred<undefined>()
    const stopped = deferred<undefined>()
    const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>()
    const quit = vi.fn()
    const showErrorBox = vi.fn()
    const runtime = {
      start: vi.fn(async () => new URL('http://127.0.0.1:53100/')),
      stop: vi.fn(() => stopped.promise),
    }
    const webContents = {
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
      restore: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      loadURL: vi.fn(() => load.promise),
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
      getAppPath: vi.fn(() => '/Applications/Voyaseek.app/Contents/Resources/app.asar'),
      isReady: vi.fn(() => true),
      quit,
    }

    function BrowserWindow(): typeof window {
      return window
    }

    function ManagedRuntime(): typeof runtime {
      return runtime
    }

    vi.doMock('../src/electron-api.js', () => ({
      app,
      BrowserWindow,
      dialog: { showErrorBox },
      Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template: unknown) => ({ template })) },
      session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
      shell: { openPath: vi.fn(async () => '') },
    }))
    vi.doMock('../src/runtime-paths.js', () => ({
      resolveRuntimeEntry: vi.fn(() => process.execPath),
    }))
    vi.doMock('../src/runtime-process.js', () => ({ ManagedRuntime }))

    await import('../src/main.js')
    await vi.waitFor(() => { expect(window.loadURL).toHaveBeenCalledWith('http://127.0.0.1:53100/') })

    const quitEvent = { preventDefault: vi.fn() }
    emit(eventHandlers, 'before-quit', quitEvent)
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    expect(runtime.stop).toHaveBeenCalledOnce()

    load.reject(new Error("ERR_FAILED (-2) loading 'http://127.0.0.1:53100/'"))
    await vi.waitFor(() => { expect(showErrorBox).not.toHaveBeenCalled() })
    expect(quit).not.toHaveBeenCalled()

    stopped.resolve(undefined)
    await vi.waitFor(() => { expect(quit).toHaveBeenCalledOnce() })
    expect(showErrorBox).not.toHaveBeenCalled()
  })
})

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

function emit(
  eventHandlers: ReadonlyMap<string, ReadonlyArray<(...args: unknown[]) => void>>,
  event: string,
  ...args: unknown[]
): void {
  for (const handler of eventHandlers.get(event) ?? []) handler(...args)
}
