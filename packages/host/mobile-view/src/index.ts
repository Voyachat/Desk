/** Header-authenticated, read-only mobile projection of session messages. */

import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@voyaseek-ai/cordis'
import z from '@voyaseek-ai/schemastery'
import { credentialRef } from '@voyaseek-ai/dsh-credentials'
import { SessionId } from '@voyaseek-ai/dsh-session'
import { extractSessionEventText } from '@voyaseek-ai/dsh-session-query'
import type {} from '@voyaseek-ai/dsh-host-webserver'
import { renderMobilePage } from './page.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mobile-view'
/** Existing server, query, and credential services required by the read-only routes. */
export const inject = ['webServer', 'sessionQuery', 'credentials']

const DEFAULT_TOKEN_REF = 'VOYASEEK_MOBILE_VIEW_TOKEN'

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
  tokenEnv: z.string().role('credential-ref').default(DEFAULT_TOKEN_REF),
  maxSessions: z.number().step(1).min(1).max(200).default(50),
  maxMessages: z.number().step(1).min(1).max(2000).default(500),
  pollIntervalMs: z.number().step(1).min(1000).max(60_000).default(3000),
  remoteHost: z.string(),
  remotePort: z.number().step(1).min(0).max(65_535).default(3081),
})

type ResolvedConfig = Required<Omit<Config, 'remoteHost'>> & Pick<Config, 'remoteHost'>

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
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
  if (pathname === '/mobile-view') {  servePage(config, res); return }
  if (pathname === '/mobile-view/api/sessions') return serveSessions(ctx, config, req, res)
  if (pathname === '/mobile-view/api/session') return serveSession(ctx, config, req, res)
  json(res, 404, { error: 'not found' })
}

/** Register the static page and its two bounded read-only JSON routes. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
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

  if (resolved.remoteHost !== undefined) {
    ctx.effect(async () => {
      const credential = await ctx.credentials.resolve(credentialRef(resolved.tokenEnv))
      if (credential === undefined) {
        throw new Error(`mobile-view: ${resolved.tokenEnv} must be configured before enabling remoteHost`)
      }
      const server = createServer((req, res) => {
        void serveRemoteRequest(ctx, resolved, req, res).catch(() => {
          if (!res.headersSent) json(res, 400, { error: 'request failed' })
          else res.destroy()
        })
      })
      server.requestTimeout = 15_000
      server.headersTimeout = 10_000
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(resolved.remotePort, resolved.remoteHost, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return () => new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) resolve()
          else reject(error)
        })
      })
    }, 'mobile-view: dedicated read-only listener')
  }
}
