/**
 * One-command acceptance launcher for the current AiDesktop checkout: build
 * every Web artifact, keep Client plugin bundles fresh, start the source Host,
 * verify the assembled application, and hand its URL to the default browser.
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { TsdownBundle } from 'tsdown'
import { discoverPluginDirs, watchClientPlugins } from './dev-web.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const DEFAULT_PORT = 3081
const READY_TIMEOUT_MS = 90_000
const READY_POLL_MS = 200
const CLIENT_POLL_MS = 500

/** Parsed acceptance-launcher command-line values. */
export interface AcceptWebOptions {
  /** Loopback port reserved for this acceptance run. */
  port: number
  /** Whether an occupied preferred port may fall forward to the next free port. */
  allowPortFallback: boolean
  /** Whether readiness hands the URL to the operating system's default browser. */
  openBrowser: boolean
}

/** A native executable and argv that open one HTTP URL without shell interpolation. */
export interface BrowserCommand {
  command: string
  args: string[]
}

/** User-visible lifecycle states printed by the acceptance launcher. */
export type AcceptWebStatus = 'building' | 'starting' | 'ready' | 'stopped' | 'failed'

const STATUS_LABELS: Readonly<Record<AcceptWebStatus, string>> = {
  building: '构建中',
  starting: '启动中',
  ready: '已就绪',
  stopped: '已停止',
  failed: '失败',
}

/**
 * Render one concise terminal status, with a browser-openable URL only after readiness.
 * @param status - current launcher lifecycle state.
 * @param url - verified assembled-application URL for the `ready` state.
 * @returns terminal text whose plain HTTP URL is clickable in ordinary terminals.
 */
export function formatAcceptWebStatus(status: AcceptWebStatus, url?: string): string {
  return `执行状态：${STATUS_LABELS[status]}${url === undefined ? '' : `\nWeb 地址：${url}`}`
}

/**
 * Parse the acceptance launcher's deliberately small flag family.
 * @param args - arguments after the script name.
 * @returns validated launch options.
 */
export function parseAcceptWebArgs(args: readonly string[]): AcceptWebOptions {
  let port = DEFAULT_PORT
  let allowPortFallback = true
  let openBrowser = true
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (index === 0 && arg === '--') continue
    if (arg === '--no-open') {
      openBrowser = false
      continue
    }
    if (arg === '--port' && args[index + 1] === undefined) {
      throw new Error('accept:web: --port must be followed by an integer')
    }
    const portText = arg === '--port' ? args[index += 1] : arg?.startsWith('--port=') ? arg.slice('--port='.length) : undefined
    if (portText !== undefined) {
      if (!/^\d+$/.test(portText)) throw new Error(`accept:web: --port must be an integer, got ${JSON.stringify(portText)}`)
      port = Number(portText)
      if (port < 1 || port > 65_535) throw new Error(`accept:web: --port must be between 1 and 65535, got ${JSON.stringify(portText)}`)
      allowPortFallback = false
      continue
    }
    throw new Error(`accept:web: unknown argument ${JSON.stringify(arg)}; usage: pnpm run accept:web -- [--port <port>] [--no-open]`)
  }
  return { port, allowPortFallback, openBrowser }
}

/**
 * Select the operating system's default-browser hand-off without a shell.
 * @param url - verified application URL.
 * @param platform - Node platform identifier.
 * @returns native executable and argv, or `undefined` on unsupported hosts.
 */
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand | undefined {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
  if (platform === 'linux') return { command: 'xdg-open', args: [url] }
  return undefined
}

/**
 * Fail before boot when another process already owns the requested loopback port.
 * @param port - exact TCP port the source Host will bind.
 */
export async function assertPortAvailable(port: number): Promise<void> {
  const probe = createServer()
  probe.unref()
  await new Promise<void>((resolveListen, rejectListen) => {
    probe.once('error', rejectListen)
    probe.listen(port, '127.0.0.1', resolveListen)
  }).catch((error: unknown) => {
    throw new Error(`accept:web: port ${String(port)} is unavailable; stop the existing process or pass --port <port>`, { cause: error })
  })
  await new Promise<void>((resolveClose, rejectClose) => {
    probe.close((error) => {
      if (error === undefined) resolveClose()
      else rejectClose(error)
    })
  })
}

/**
 * Reserve the preferred port policy before building: default launches may
 * fall forward for parallel acceptance, while explicit ports remain exact.
 * @param preferredPort - default or explicitly requested loopback port.
 * @param allowFallback - whether to scan upward after an occupied port.
 * @returns the first available port allowed by the caller's policy.
 */
export async function selectAcceptWebPort(preferredPort: number, allowFallback: boolean): Promise<number> {
  try {
    await assertPortAvailable(preferredPort)
    return preferredPort
  } catch (error: unknown) {
    if (!allowFallback) throw error
  }
  for (let candidate = preferredPort + 1; candidate <= 65_535; candidate += 1) {
    try {
      await assertPortAvailable(candidate)
      return candidate
    } catch {
      // Continue past ports already owned by another local process.
    }
  }
  throw new Error(`accept:web: no available loopback port at or above ${String(preferredPort)}`)
}

/**
 * Wait until the URL serves the assembled DSH application rather than a bare
 * Vite shell or unrelated HTTP process.
 * @param url - loopback application URL.
 * @param signal - launcher lifetime.
 * @param request - injectable HTTP request operation for tests.
 */
export async function waitForWebApplication(
  url: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let lastFailure = 'no response'
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]) })
      const body = await response.text()
      if (response.ok && body.includes('window.__DSH_BOOT__')) return
      lastFailure = `HTTP ${String(response.status)} without assembled boot data`
    } catch (error: unknown) {
      lastFailure = error instanceof Error ? error.message : String(error)
    }
    await new Promise<void>((resolvePoll) => {
      const stopPolling = (): void => {
        clearTimeout(timer)
        resolvePoll()
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', stopPolling)
        resolvePoll()
      }, READY_POLL_MS)
      signal.addEventListener('abort', stopPolling, { once: true })
    })
  }
  if (signal.aborted) throw signal.reason
  throw new Error(`accept:web: application did not become ready at ${url} within ${String(READY_TIMEOUT_MS / 1_000)}s (${lastFailure})`)
}

function pnpmExecutable(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function waitForChild(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveExit()
      else rejectExit(new Error(`${label} exited with ${signal === null ? `code ${String(code)}` : `signal ${signal}`}`))
    })
  })
}

async function stopChild(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  if (!child.kill('SIGTERM')) throw new Error(`accept:web: failed to stop child process ${String(child.pid ?? 'without pid')}`)
  await exited
}

function startSourceHost(port: number): ChildProcess {
  const child = spawn(process.execPath, [
    '--import',
    'tsx/esm',
    resolve(repoRoot, 'scripts/dev-aistaff.ts'),
    '--port',
    String(port),
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  return child
}

function handOffToBrowser(url: string): void {
  const selected = browserCommand(url)
  if (selected === undefined) {
    console.warn(`accept:web: cannot name a default-browser command on ${process.platform}; open ${url} manually`)
    return
  }
  const child = spawn(selected.command, selected.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', (error) => {
    console.warn(`accept:web: browser hand-off failed (${error.message}); open ${url} manually`)
  })
  child.unref()
}

async function run(options: AcceptWebOptions): Promise<void> {
  const abort = new AbortController()
  let port = options.port
  let url = `http://127.0.0.1:${String(port)}`
  let interruptedBy: NodeJS.Signals | undefined
  let build: ChildProcess | undefined
  let host: ChildProcess | undefined
  let bundles: TsdownBundle[] = []
  let watcherReady: Promise<void> | undefined
  const interrupt = (signal: NodeJS.Signals): void => {
    interruptedBy = signal
    abort.abort(new Error(`accept:web: interrupted by ${signal}`))
    build?.kill('SIGTERM')
  }
  const interruptInt = (): void => { interrupt('SIGINT') }
  const interruptTerm = (): void => { interrupt('SIGTERM') }
  process.once('SIGINT', interruptInt)
  process.once('SIGTERM', interruptTerm)
  try {
    port = await selectAcceptWebPort(options.port, options.allowPortFallback)
    url = `http://127.0.0.1:${String(port)}`
    if (port !== options.port) console.log(`accept:web: port ${String(options.port)} is occupied; using ${String(port)} instead`)
    console.log(formatAcceptWebStatus('building'))
    console.log('accept:web: building the current checkout...')
    build = spawn(pnpmExecutable(), ['run', 'build'], { cwd: repoRoot, env: process.env, stdio: 'inherit' })
    await waitForChild(build, 'accept:web build')
    build = undefined

    const pluginDirs = discoverPluginDirs(repoRoot)
    if (pluginDirs.length === 0) throw new Error('accept:web: no Web Client plugin packages were found')
    console.log(formatAcceptWebStatus('starting'))
    console.log('accept:web: starting the source Host and Client plugin watcher...')
    watcherReady = watchClientPlugins(repoRoot, pluginDirs, CLIENT_POLL_MS).then((readyBundles) => {
      bundles = readyBundles
    })
    host = startSourceHost(port)
    const hostExit = waitForChild(host, 'accept:web Host').then(() => {
      if (!abort.signal.aborted) abort.abort(new Error('accept:web: Host stopped before the launcher'))
    }, (error: unknown) => {
      if (!abort.signal.aborted) abort.abort(error)
    })
    await Promise.all([watcherReady, waitForWebApplication(url, abort.signal)])
    console.log(formatAcceptWebStatus('ready', url))
    if (options.openBrowser) handOffToBrowser(url)
    console.log('accept:web: Client plugin changes reload automatically; rebuild and refresh for Web shell or Host contract changes. Press Ctrl+C to stop.')
    await hostExit
    if (abort.signal.aborted) throw abort.signal.reason
  } finally {
    process.off('SIGINT', interruptInt)
    process.off('SIGTERM', interruptTerm)
    await watcherReady?.catch(() => {})
    const cleanup = await Promise.allSettled([
      ...bundles.map(bundle => bundle[Symbol.asyncDispose]()),
      stopChild(host),
      stopChild(build),
    ])
    const cleanupFailure = cleanup.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (cleanupFailure !== undefined) throw cleanupFailure.reason
    if (interruptedBy !== undefined) console.log(formatAcceptWebStatus('stopped'))
    if (interruptedBy === 'SIGINT') process.exitCode = 130
    else if (interruptedBy === 'SIGTERM') process.exitCode = 0
  }
}

const invokedPath = process.argv[1]
const isMain = invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href
if (isMain) {
  try {
    await run(parseAcceptWebArgs(process.argv.slice(2)))
  } catch (error: unknown) {
    if (process.exitCode === undefined) process.exitCode = 1
    if (process.exitCode !== 0 && process.exitCode !== 130) {
      console.error(formatAcceptWebStatus('failed'))
      console.error(error instanceof Error ? error.message : error)
    }
  }
}
