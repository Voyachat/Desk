import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BrowserWindow as BrowserWindowInstance, MenuItemConstructorOptions } from 'electron'
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from './electron-api.js'
import { loadModelCredentials } from './model-credentials.js'
import { ensureAistaffProfile } from './profile.js'
import { resolveProxyEnvironment } from './proxy-environment.js'
import { ManagedRuntime } from './runtime-process.js'
import { resolveRuntimeEntry } from './runtime-paths.js'
import {
  assertTrustedStartupSender,
  parseStartupIntent,
  STARTUP_CHANNELS,
  type StartupIntent,
  type StartupState,
} from './startup-ipc.js'
import { createWindowOptions, isDirectProxyResolution, isOwnedDocument } from './window-policy.js'

let mainWindow: BrowserWindowInstance | undefined
let runtime: ManagedRuntime | undefined
let runtimeUrl: URL | undefined
let runtimeAttempt: Promise<void> | undefined
let startupDocument = ''
let startupDocumentUrl = new URL('file:///invalid-startup-document')
let startupIntent: StartupIntent | null = { draft: '', agentPreset: 'standard' }
let startupState: StartupState = { phase: 'starting' }
let shutdownStarted = false
let shutdownComplete = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
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
  const appPath = app.getAppPath()
  const preload = join(appPath, 'dist', 'preload.cjs')
  startupDocument = join(appPath, 'assets', 'startup.html')
  startupDocumentUrl = pathToFileURL(startupDocument)
  const window = new BrowserWindow(createWindowOptions(preload))
  mainWindow = window
  configureWindow(window)
  registerStartupIpc(window)
  await window.loadFile(startupDocument)
  window.show()
  if (shutdownStarted) return
  beginRuntimeAttempt(window)
}

function beginRuntimeAttempt(window: BrowserWindowInstance): void {
  if (runtimeAttempt !== undefined || startupState.phase === 'ready' || shutdownStarted) return
  const attempt = launchRuntime(window).catch(async (error: unknown) => {
    runtimeUrl = undefined
    if (runtime !== undefined) await runtime.stop()
    if (shutdownStarted || mainWindow !== window) return
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Voyaseek runtime failed to start: ${message}\n`)
    await showRuntimeFailure(message)
  })
  const trackedAttempt = attempt.finally(() => {
    if (runtimeAttempt === trackedAttempt) runtimeAttempt = undefined
  })
  runtimeAttempt = trackedAttempt
}

async function launchRuntime(window: BrowserWindowInstance): Promise<void> {
  setStartupState({ phase: 'starting' })
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
      void showRuntimeFailure(message)
    },
  })
  runtime = launchedRuntime
  try {
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
    setStartupState({ phase: 'ready' })
    await window.loadURL(readyUrl.href)
  } catch (error) {
    runtimeUrl = undefined
    await launchedRuntime.stop()
    if (shutdownStarted || mainWindow !== window) return
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Voyaseek runtime failed to start: ${message}\n`)
    await showRuntimeFailure(message)
  }
}

function configureWindow(window: BrowserWindowInstance): void {
  const contents = window.webContents
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => { event.preventDefault() })
  contents.on('will-redirect', (event) => { event.preventDefault() })
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
  contents.on('did-navigate', (_event, url) => {
    if (!isOwnedDocument(url, startupDocumentUrl, runtimeUrl)) window.destroy()
  })
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  contents.session.setPermissionCheckHandler(() => false)
  window.once('ready-to-show', () => { window.show() })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
}

function registerStartupIpc(window: BrowserWindowInstance): void {
  const authorize = (event: Electron.IpcMainInvokeEvent): void => {
    assertTrustedStartupSender(event, mainWindow, startupDocumentUrl, runtimeUrl)
  }
  ipcMain.handle(STARTUP_CHANNELS.getIntent, (event) => {
    authorize(event)
    return startupIntent
  })
  ipcMain.handle(STARTUP_CHANNELS.setIntent, (event, value: unknown) => {
    authorize(event)
    startupIntent = parseStartupIntent(value)
    return startupIntent
  })
  ipcMain.handle(STARTUP_CHANNELS.acknowledge, (event) => {
    authorize(event)
    startupIntent = null
  })
  ipcMain.handle(STARTUP_CHANNELS.getState, (event) => {
    authorize(event)
    return startupState
  })
  ipcMain.handle(STARTUP_CHANNELS.retry, (event) => {
    authorize(event)
    if (startupState.phase === 'failed') beginRuntimeAttempt(window)
    return startupState
  })
}

function setStartupState(state: StartupState): void {
  startupState = state
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  window.webContents.send(STARTUP_CHANNELS.stateChanged, state)
}

async function showRuntimeFailure(message: string): Promise<void> {
  runtimeUrl = undefined
  if (shutdownStarted) return
  setStartupState({ phase: 'failed', message: startupFailureMessage(message) })
  const window = mainWindow
  if (window === undefined || window.isDestroyed()) return
  try {
    await window.loadFile(startupDocument)
    window.show()
  } catch (error) {
    const loadMessage = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Voyaseek failed to restore its startup page: ${loadMessage}\n`)
  }
}

function startupFailureMessage(message: string): string {
  const normalized = message.replace(/[\r\n]+/gu, ' ').trim()
  if (normalized.length === 0) return '未知错误'
  return normalized.slice(0, 500)
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
  if (shutdownStarted) return
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Voyaseek failed to start: ${message}\n`)
  if (app.isReady()) dialog.showErrorBox('Voyaseek 无法启动', message)
  app.quit()
}
