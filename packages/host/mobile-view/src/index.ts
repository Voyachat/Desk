/** Header-authenticated, read-only mobile projection of session messages. */

import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import { credentialRef } from '@voyaseek-ai/dsh-credentials'
import { SessionId } from '@voyaseek-ai/dsh-session'
import { extractSessionEventText } from '@voyaseek-ai/dsh-session-query'
import { settingsNamespace } from '@voyaseek-ai/dsh-settings'
import type {} from '@voyaseek-ai/dsh-host-webserver'
import { renderMobilePage } from './page.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mobile-view'
/** Existing services required by the read-only routes and their live preference. */
export const inject = ['webServer', 'sessionQuery', 'credentials', 'settings']

/** Credential reference used by the settings page and request authenticator. */
export const MOBILE_VIEW_TOKEN_REF = 'VOYASEEK_MOBILE_VIEW_TOKEN'
/** Durable user-settings namespace for the dedicated listener. */
export const MOBILE_VIEW_SETTINGS_NAMESPACE = 'mobile-view'
const MOBILE_VIEW_NAMESPACE = settingsNamespace(MOBILE_VIEW_SETTINGS_NAMESPACE)

/** User-controlled dedicated-listener preference. */
export interface MobileViewSettings {
  /** Whether the LAN listener is requested. */
  enabled: boolean
  /** TCP port used by the LAN listener. */
  port: number
}

/** Schema shared by the Host settings registration. */
export const MobileViewSettingsSchema: z<MobileViewSettings> = z.object({
  enabled: z.boolean().default(false),
  port: z.number().step(1).min(1).max(65_535).default(3081),
})

/** Read-only mobile viewer limits and credential reference. */
export interface Config {
  /** Credential reference containing the bearer token. */
  tokenEnv?: string
  /** Maximum newest sessions returned to the page. */
  maxSessions?: number
  /** Maximum newest user/assistant messages returned for one session. */
  maxMessages?: number
  /** Browser refresh interval in milliseconds. */
  pollIntervalMs?: number
  /** Optional dedicated read-only listener host, such as `0.0.0.0`. */
  remoteHost?: string
  /** Dedicated read-only listener port. */
  remotePort?: number
}

/** Validated mobile-view configuration. */
export const Config: z<Config> = z.object({
  tokenEnv: z.string().role('credential-ref').default(MOBILE_VIEW_TOKEN_REF),
  maxSessions: z.number().step(1).min(1).max(200).default(50),
  maxMessages: z.number().step(1).min(1).max(2000).default(500),
  pollIntervalMs: z.number().step(1).min(1000).max(60_000).default(3000),
  remoteHost: z.string(),
  remotePort: z.number().step(1).min(1).max(65_535).default(3081),
})

type ResolvedConfig = Required<Omit<Config, 'remoteHost'>> & Pick<Config, 'remoteHost'>

type ListenerFailure = 'token-missing' | 'port-unavailable' | 'listener-failed'

interface ListenerStatus {
  requested: boolean
  listening: boolean
  port: number
  urls: string[]
  error?: ListenerFailure
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

function lanUrls(port: number): string[] {
  const addresses = new Set<string>()
  for (const records of Object.values(networkInterfaces())) {
    for (const record of records ?? []) {
      if (record.internal || record.family !== 'IPv4') continue
      addresses.add(record.address)
    }
  }
  return [...addresses]
    .sort((left, right) => left.localeCompare(right))
    .map(address => `http://${address}:${String(port)}/mobile-view`)
}

function listenerFailure(error: unknown): ListenerFailure {
  return (error as NodeJS.ErrnoException | null)?.code === 'EADDRINUSE'
    ? 'port-unavailable'
    : 'listener-failed'
}

class MobileViewListener {
  private server: Server | undefined
  private state: ListenerStatus = { requested: false, listening: false, port: 3081, urls: [] }
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /** Read the committed listener state without exposing its credential. */
  snapshot(): ListenerStatus {
    return { ...this.state, urls: [...this.state.urls] }
  }

  /** Serialize one requested listener transition behind every prior close/start. */
  reconfigure(preference: MobileViewSettings): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const next = { ...preference }
    const task = this.tail.then(() => this.apply(next), () => this.apply(next))
    this.tail = task.catch(() => {})
    return task
  }

  /** Stop accepting transitions and close the owned listener. */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.tail
    await this.close()
  }

  private async apply(preference: MobileViewSettings): Promise<void> {
    if (this.disposed) return
    if (this.server !== undefined && this.state.listening && this.state.port === preference.port) {
      if (preference.enabled) {
        this.state = {
          requested: true,
          listening: true,
          port: preference.port,
          urls: lanUrls(preference.port),
        }
        return
      }
    }
    await this.close()
    this.state = { requested: preference.enabled, listening: false, port: preference.port, urls: [] }
    if (!preference.enabled || this.disposed) return

    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.tokenEnv))
    if (credential === undefined) {
      this.state = { ...this.state, error: 'token-missing' }
      return
    }

    const server = createServer((req, res) => {
      void serveRemoteRequest(this.ctx, this.config, req, res).catch(() => {
        if (!res.headersSent) json(res, 400, { error: 'request failed' })
        else res.destroy()
      })
    })
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(preference.port, this.config.remoteHost ?? '0.0.0.0', () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch (error) {
      this.state = { ...this.state, error: listenerFailure(error) }
      return
    }
    server.on('error', (error) => {
      this.ctx.logger.warn('mobile-view: dedicated listener failed')
      this.ctx.logger.warn(error)
      this.state = { ...this.state, listening: false, urls: [], error: listenerFailure(error) }
    })
    this.server = server
    this.state = {
      requested: true,
      listening: true,
      port: preference.port,
      urls: lanUrls(preference.port),
    }
  }

  private async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      })
    })
    server.closeAllConnections()
    await closed
  }
}

function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers.authorization
  if (value === undefined || !value.startsWith('Bearer ')) return undefined
  const token = value.slice('Bearer '.length)
  return token.length === 0 ? undefined : token
}

async function authorized(ctx: Context, config: ResolvedConfig, req: IncomingMessage): Promise<boolean> {
  const expected = await ctx.credentials.resolve(credentialRef(config.tokenEnv))
  const offered = bearer(req)
  if (expected === undefined || offered === undefined) return false
  const left = Buffer.from(expected.value)
  const right = Buffer.from(offered)
  return left.length === right.length && timingSafeEqual(left, right)
}

async function requireAuthorization(
  ctx: Context,
  config: ResolvedConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (req.method !== 'GET') {
    json(res, 405, { error: 'read-only endpoint' })
    return false
  }
  if (!await authorized(ctx, config, req)) {
    res.setHeader('www-authenticate', 'Bearer')
    json(res, 401, { error: 'unauthorized' })
    return false
  }
  return true
}

function servePage(config: ResolvedConfig, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(renderMobilePage(config.pollIntervalMs))
}

async function serveSessions(
  ctx: Context,
  config: ResolvedConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!await requireAuthorization(ctx, config, req, res)) return
  const records = (await ctx.sessionQuery.listSessions()).slice(0, config.maxSessions)
  const titles = await ctx.sessionQuery.readTitleSnapshots(records.map(record => record.header.id))
  json(res, 200, {
    sessions: records.map((record, index) => {
      const title = titles[index]
      return {
        sessionId: record.header.id,
        createdAt: record.header.createdAt,
        title: title?.status === 'fulfilled' ? title.value.title?.title ?? '' : '',
      }
    }),
  })
}

async function serveSession(
  ctx: Context,
  config: ResolvedConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!await requireAuthorization(ctx, config, req, res)) return
  const sessionId = new URL(req.url ?? '/', 'http://local').searchParams.get('sessionId')
  if (sessionId === null || sessionId.length === 0 || sessionId.length > 256) {
    json(res, 400, { error: 'sessionId is required' })
    return
  }
  const snapshot = await ctx.sessionQuery.readSession(SessionId(sessionId))
  const messages = snapshot.events.flatMap((event) => {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') return []
    const text = extractSessionEventText(event)
    return text.length === 0 ? [] : [{
      seq: event.seq,
      time: event.time,
      role: event.type === 'user/message' ? 'user' : 'assistant',
      text,
    }]
  }).slice(-config.maxMessages)
  json(res, 200, { sessionId, messages })
}

async function serveRemoteRequest(
  ctx: Context,
  config: ResolvedConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://local').pathname
  if (pathname === '/mobile-view') { servePage(config, res); return }
  if (pathname === '/mobile-view/api/sessions') return serveSessions(ctx, config, req, res)
  if (pathname === '/mobile-view/api/session') return serveSession(ctx, config, req, res)
  json(res, 404, { error: 'not found' })
}

/** Register the static page, bounded JSON routes, and live LAN-listener preference. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  const listener = new MobileViewListener(ctx, resolved)
  const settings = ctx.settings.register(MOBILE_VIEW_NAMESPACE, MobileViewSettingsSchema, {
    base: {
      enabled: resolved.remoteHost !== undefined,
      port: resolved.remotePort,
    },
  })
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/mobile-view',
    handler: (_req, res) => { servePage(resolved, res) },
  }), 'mobile-view: page route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/mobile-view/api/sessions',
    handler: (req, res) => serveSessions(ctx, resolved, req, res),
  }), 'mobile-view: sessions route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/mobile-view/api/session',
    handler: (req, res) => serveSession(ctx, resolved, req, res),
  }), 'mobile-view: session route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/mobile-view/api/status',
    handler: (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'read-only endpoint' })
        return
      }
      json(res, 200, listener.snapshot())
    },
  }), 'mobile-view: listener status route')

  ctx.effect(() => settings.watch(next => listener.reconfigure(next)), 'mobile-view: settings listener')
  ctx.effect(() => ctx.on('credentials/updated', (ref) => {
    if (ref !== credentialRef(resolved.tokenEnv)) return
    void listener.reconfigure(settings.get())
  }), 'mobile-view: credential listener')
  ctx.effect(async () => {
    await listener.reconfigure(settings.get())
    return () => listener.dispose()
  }, 'mobile-view: dedicated read-only listener')
}
