import { isIP } from 'node:net'

const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com/'
const DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/'
const LOOPBACK_NO_PROXY = ['127.0.0.1', 'localhost'] as const

/** Maximum time system PAC discovery may delay the managed runtime. */
const DEFAULT_PROXY_RESOLUTION_TIMEOUT_MS = 3_000

/**
 * Resolve the environment additions needed for a Node child to follow Electron's
 * effective HTTPS proxy without replacing an explicitly inherited HTTPS proxy.
 * @param resolveProxy - Electron-compatible resolver returning a PAC proxy list.
 * @param inherited - Environment that will be spread before the returned additions.
 * @param timeoutMs - Upper bound for both system PAC lookups together.
 * @returns A fresh, credential-free environment overlay.
 */
export async function resolveProxyEnvironment(
  resolveProxy: (url: string) => Promise<string>,
  inherited: Readonly<NodeJS.ProcessEnv>,
  timeoutMs = DEFAULT_PROXY_RESOLUTION_TIMEOUT_MS,
): Promise<Readonly<NodeJS.ProcessEnv>> {
  const noProxy = mergeNoProxy(inherited.NO_PROXY ?? inherited.no_proxy)
  if (
    inherited.HTTPS_PROXY !== undefined
    || inherited.https_proxy !== undefined
    || inherited.HTTP_PROXY !== undefined
    || inherited.http_proxy !== undefined
  ) {
    return {
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: noProxy,
      no_proxy: noProxy,
    }
  }

  let googleProxy: string | undefined
  let dashscopeProxy: string | undefined
  try {
    [googleProxy, dashscopeProxy] = await withTimeout(
      Promise.all([
        resolveProxy(GOOGLE_API_URL).then(parseHttpProxy),
        resolveProxy(DASHSCOPE_API_URL).then(parseHttpProxy),
      ]),
      timeoutMs,
    )
  } catch {
    // A system proxy lookup failure must not prevent the local desktop from starting.
    return {}
  }
  if (googleProxy === undefined || googleProxy !== dashscopeProxy) return {}

  return {
    HTTP_PROXY: googleProxy,
    HTTPS_PROXY: googleProxy,
    NODE_USE_ENV_PROXY: '1',
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  }
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error('system proxy resolution timed out')) }, timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([task, timeout])
  } finally {
    clearTimeout(timer)
  }
}

function parseHttpProxy(resolution: string): string | undefined {
  if (/\r|\n/u.test(resolution)) return undefined

  for (const rawCandidate of resolution.split(';')) {
    const candidate = rawCandidate.trim()
    if (/^DIRECT$/iu.test(candidate)) return undefined
    const match = /^(PROXY|HTTPS)[ \t]+([^ \t]+)$/iu.exec(candidate)
    const kind = match?.[1]?.toUpperCase()
    const authority = match?.[2]
    if (kind !== undefined && authority !== undefined && isValidAuthority(authority)) {
      return `${kind === 'HTTPS' ? 'https' : 'http'}://${authority}`
    }
    if (candidate.length > 0) return undefined
  }
  return undefined
}

function isValidAuthority(authority: string): boolean {
  const bracketed = /^\[([^\]]+)\]:([0-9]{1,5})$/u.exec(authority)
  if (bracketed !== null) {
    const host = bracketed[1]
    const port = bracketed[2]
    return host !== undefined && port !== undefined && isIP(host) === 6 && isValidPort(port)
  }

  const hostname = /^([^:]+):([0-9]{1,5})$/u.exec(authority)
  if (hostname === null) return false
  const host = hostname[1]
  const port = hostname[2]
  return host !== undefined && port !== undefined && isValidHostname(host) && isValidPort(port)
}

function isValidHostname(host: string): boolean {
  if (isIP(host) === 4) return true
  if (/^[0-9.]+$/u.test(host)) return false

  const hostname = host.endsWith('.') ? host.slice(0, -1) : host
  if (hostname.length === 0 || hostname.length > 253) return false
  return hostname.split('.').every(label => (
    label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label)
  ))
}

function isValidPort(port: string): boolean {
  const numericPort = Number(port)
  return numericPort >= 1 && numericPort <= 65_535
}

function mergeNoProxy(existing: string | undefined): string {
  const entries = existing?.split(',').map(entry => entry.trim()).filter(entry => entry.length > 0) ?? []
  const normalizedEntries = new Set(entries.map(entry => entry.toLowerCase()))
  const missingEntries = LOOPBACK_NO_PROXY.filter(entry => !normalizedEntries.has(entry))
  if (existing === undefined || existing.trim().length === 0) return LOOPBACK_NO_PROXY.join(',')
  if (missingEntries.length === 0) return existing
  const separator = existing.trimEnd().endsWith(',') ? '' : ','
  return `${existing}${separator}${missingEntries.join(',')}`
}
