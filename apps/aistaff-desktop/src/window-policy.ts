import type { BrowserWindowConstructorOptions } from 'electron'

/** Create the fixed renderer security preferences. */
export function createWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  }
}

/** Return true only for the exact renderer origin delivered by the managed runtime. */
export function isRuntimeDocument(url: string, runtimeUrl: URL): boolean {
  try {
    const candidate = new URL(url)
    return candidate.protocol === 'http:'
      && candidate.hostname === '127.0.0.1'
      && candidate.port === runtimeUrl.port
      && candidate.username === ''
      && candidate.password === ''
  } catch {
    return false
  }
}

/** Accept only a proxy resolution that cannot fall back from loopback to a proxy. */
export function isDirectProxyResolution(resolution: string): boolean {
  if (/\r|\n/u.test(resolution)) return false
  const directives = resolution.split(';').map(value => value.trim()).filter(value => value.length > 0)
  return directives.length > 0 && directives.every(value => /^DIRECT$/iu.test(value))
}
