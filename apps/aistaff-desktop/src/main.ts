import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserWindow as BrowserWindowInstance, MenuItemConstructorOptions } from 'electron'
import { app, BrowserWindow, dialog, Menu, session, shell } from './electron-api.js'
import { loadModelCredentials } from './model-credentials.js'
import { ensureAistaffProfile } from './profile.js'
import { resolveProxyEnvironment } from './proxy-environment.js'
import { ManagedRuntime } from './runtime-process.js'
import { resolveRuntimeEntry } from './runtime-paths.js'
import { createWindowOptions, isDirectProxyResolution, isRuntimeDocument } from './window-policy.js'

let mainWindow: BrowserWindowInstance | undefined
let runtime: ManagedRuntime | undefined
let runtimeUrl: URL | undefined
let runtimeAttempt: Promise<void> | undefined
let shutdownStarted = false
let shutdownComplete = false
let failureReported = false

const RUNTIME_HOME_LOAD_TIMEOUT_MS = 30_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined || !mainWindow.isVisible()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (shutdownComplete || shutdownStarted) return
    shutdownStarted = true
    if (runtime === undefined) return
    event.preventDefault()
    void runtime.stop().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
  void app.whenReady().then(startApplication).catch(reportStartupFailure)
}

async function startApplication(): Promise<void> {
  installApplicationMenu()
  const preload = join(app.getAppPath(), 'dist', 'preload.cjs')
  const window = new BrowserWindow(createWindowOptions(preload))
  mainWindow = window
  configureWindow(window)
  if (shutdownStarted) return
  beginRuntimeAttempt(window)
}

function beginRuntimeAttempt(window: BrowserWindowInstance): void {
  if (runtimeAttempt !== undefined || shutdownStarted) return
  const attempt = launchRuntime(window).catch(async (error: unknown) => {
    runtimeUrl = undefined
    const failedRuntime = runtime
    runtime = undefined
    if (failedRuntime !== undefined) await failedRuntime.stop()
    if (shutdownStarted || mainWindow !== window) return
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Voyaseek runtime failed to start: ${message}\n`)
    reportRuntimeFailure(message)
  })
  const trackedAttempt = attempt.finally(() => {
    if (runtimeAttempt === trackedAttempt) runtimeAttempt = undefined
  })
  runtimeAttempt = trackedAttempt
}

async function launchRuntime(window: BrowserWindowInstance): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
  const previousRuntime = runtime
  if (previousRuntime !== undefined) await previousRuntime.stop()
  if (shutdownStarted || mainWindow !== window) return

  const userData = app.getPath('userData')
  const dshHome = join(userData, 'dsh')
  const workspace = join(userData, 'workspace')
  mkdirSync(workspace, { recursive: true })
  ensureAistaffProfile(dshHome, app.getLocaleCountryCode())
  const credentialEnvironment = loadModelCredentials(app.getPath('home'))
  const networkEnvironment = await resolveProxyEnvironment(
    url => session.defaultSession.resolveProxy(url),
    process.env,
  )
  if (shutdownStarted || mainWindow !== window) return

  const entry = resolveRuntimeEntry(app.isPackaged, process.resourcesPath, app.getAppPath())
  if (!existsSync(entry)) throw new Error(`Bundled DSH runtime is missing: ${entry}`)
  const launchedRuntime = new ManagedRuntime({
    executable: process.execPath,
    entry,
    dshHome,
    cwd: workspace,
    credentialEnvironment,
    networkEnvironment,
    onLog: message => process.stderr.write(message),
    onUnexpectedExit: (message) => {
      process.stderr.write(`${message}\n`)
      reportRuntimeFailure(message)
    },
  })
  runtime = launchedRuntime
  const readyUrl = await launchedRuntime.start()
  if (shutdownStarted || mainWindow !== window) {
    await launchedRuntime.stop()
    return
  }
  const runtimeProxy = await window.webContents.session.resolveProxy(readyUrl.href)
  if (!isDirectProxyResolution(runtimeProxy)) {
    throw new Error('Bundled DSH loopback runtime is not configured for direct access')
  }
  runtimeUrl = readyUrl
  await loadRuntimeHome(window, readyUrl)
  if (shutdownStarted || failureReported || mainWindow !== window || window.isDestroyed()) return
  window.show()
}

async function loadRuntimeHome(window: BrowserWindowInstance, readyUrl: URL): Promise<void> {
  let markReadyToShow!: () => void
  const readyToShow = new Promise<void>((resolve) => {
    markReadyToShow = resolve
  })
  window.once('ready-to-show', markReadyToShow)

  let timeout: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.stop()
      reject(new Error('Timed out waiting for the Voyaseek home page'))
    }, RUNTIME_HOME_LOAD_TIMEOUT_MS)
    timeout.unref()
  })

  try {
    await Promise.race([
      Promise.all([window.loadURL(readyUrl.href), readyToShow]),
      timedOut,
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    window.removeListener('ready-to-show', markReadyToShow)
  }
}

function configureWindow(window: BrowserWindowInstance): void {
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => { event.preventDefault() })
  contents.on('will-redirect', (event) => { event.preventDefault() })
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
  contents.on('did-navigate', (_event, url) => {
    if (runtimeUrl === undefined || !isRuntimeDocument(url, runtimeUrl)) window.destroy()
  })
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  contents.session.setPermissionCheckHandler(() => false)
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
}

function reportRuntimeFailure(message: string): void {
  runtimeUrl = undefined
  if (shutdownStarted || failureReported) return
  failureReported = true
  const normalized = message.replace(/[\r\n]+/gu, ' ').trim()
  const detail = normalized.length === 0 ? '未知错误' : normalized.slice(0, 500)
  dialog.showErrorBox('Voyaseek 无法启动', detail)
  app.quit()
}

/** Install the branded menu; the Help submenu opens the bundled legal texts. */
function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: '用户协议',
          click: () => { void openLegalDocument('USER_AGREEMENT.zh-CN.md') },
        },
        {
          label: '开源软件许可',
          click: () => { void openLegalDocument('third-party', 'deepseek-harness', 'LICENSE') },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Open one document of the legal bundle shipped inside the app resources. */
async function openLegalDocument(...parts: string[]): Promise<void> {
  const root = app.isPackaged ? join(process.resourcesPath, 'legal') : join(app.getAppPath(), 'legal')
  const target = join(root, ...parts)
  const errorMessage = await shell.openPath(target)
  if (errorMessage !== '') dialog.showErrorBox('Voyaseek', `无法打开 ${target}\n${errorMessage}`)
}

function reportStartupFailure(error: unknown): void {
  if (shutdownStarted || failureReported) return
  failureReported = true
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Voyaseek failed to start: ${message}\n`)
  if (app.isReady()) dialog.showErrorBox('Voyaseek 无法启动', message)
  app.quit()
}
