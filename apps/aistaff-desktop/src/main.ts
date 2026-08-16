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
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (shutdownComplete || runtime === undefined) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    void runtime.stop().finally(() => {
      shutdownComplete = true
      app.quit()
    })
  })
  void app.whenReady().then(startApplication).catch(reportStartupFailure)
}

async function startApplication(): Promise<void> {
  installApplicationMenu()
  const userData = app.getPath('userData')
  const dshHome = join(userData, 'dsh')
  const workspace = join(userData, 'workspace')
  mkdirSync(workspace, { recursive: true })
  ensureAistaffProfile(dshHome)
  const credentialEnvironment = loadModelCredentials(app.getPath('home'))
  const networkEnvironment = await resolveProxyEnvironment(
    (url) => session.defaultSession.resolveProxy(url),
    process.env,
  )

  const entry = resolveRuntimeEntry(app.isPackaged, process.resourcesPath, app.getAppPath())
  if (!existsSync(entry)) throw new Error(`Bundled DSH runtime is missing: ${entry}`)
  runtime = new ManagedRuntime({
    executable: process.execPath,
    entry,
    dshHome,
    cwd: workspace,
    credentialEnvironment,
    networkEnvironment,
    onLog: (message) => process.stderr.write(message),
    onUnexpectedExit: (message) => {
      process.stderr.write(`${message}\n`)
      app.quit()
    },
  })
  const runtimeUrl = await runtime.start()
  const preload = join(app.getAppPath(), 'dist', 'preload.js')
  const window = new BrowserWindow(createWindowOptions(preload))
  mainWindow = window
  const contents = window.webContents
  const runtimeProxy = await contents.session.resolveProxy(runtimeUrl.href)
  if (!isDirectProxyResolution(runtimeProxy)) {
    window.destroy()
    throw new Error('Bundled DSH loopback runtime is not configured for direct access')
  }

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event) => event.preventDefault())
  contents.on('will-redirect', (event) => event.preventDefault())
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.on('did-navigate', (_event, url) => {
    if (!isRuntimeDocument(url, runtimeUrl)) window.destroy()
  })
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  contents.session.setPermissionCheckHandler(() => false)
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(runtimeUrl.href)
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
