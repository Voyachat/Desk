/** Real Loader composition for the read-only mobile HTTP surface. */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@voyaseek-ai/cordis'
import Loader from '@voyaseek-ai/cordis-plugin-loader'
import Include from '@voyaseek-ai/cordis-plugin-include'
import { SESSION_FORMAT_VERSION, SessionId } from '@voyaseek-ai/dsh-session'
import HttpServer from '@voyaseek-ai/dsh-host-webserver'
import * as MobileView from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const CredentialsFixture = {
  name: 'mobile-credentials-fixture',
  apply(ctx: Context): void {
    ctx.provide('credentials', {
      resolve: async () => ({ value: 'test-token', source: 'fixture' }),
    } as never)
  },
}

const SessionQueryFixture = {
  name: 'mobile-session-query-fixture',
  apply(ctx: Context): void {
    ctx.provide('sessionQuery', {
      listSessions: async () => [
        { header: { version: SESSION_FORMAT_VERSION, id: SessionId('newest'), createdAt: 2 }, live: true, persisted: true },
        { header: { version: SESSION_FORMAT_VERSION, id: SessionId('older'), createdAt: 1 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async () => [{
        status: 'fulfilled',
        value: {
          session: { version: SESSION_FORMAT_VERSION, id: SessionId('newest'), createdAt: 2 },
          title: { title: 'Mobile title', messageSeqs: [], source: 'user', eventSeq: 3, updatedAt: 4 },
        },
      }],
      readSession: async (sessionId: ReturnType<typeof SessionId>) => ({
        session: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 2 },
        events: [
          { type: 'turn/start', seq: 0, time: 10 },
          { type: 'user/message', seq: 1, time: 11, data: { content: [{ type: 'text', text: 'hello' }] } },
          { type: 'assistant/message', seq: 2, time: 12, data: { message: { content: [{ type: 'text', text: 'world' }] } } },
        ],
      }),
    } as never)
  },
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test listener has no TCP port')
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
  return address.port
}

async function loadComposition(remotePort: number): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-mobile-view-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@voyaseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: 'fixture:credentials'",
    "- name: 'fixture:session-query'",
    "- name: '@voyaseek-ai/dsh-mobile-view'",
    '  config:',
    "    tokenEnv: 'TEST_MOBILE_TOKEN'",
    '    maxSessions: 1',
    '    maxMessages: 1',
    '    pollIntervalMs: 1000',
    "    remoteHost: '127.0.0.1'",
    `    remotePort: ${String(remotePort)}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@voyaseek-ai/dsh-host-webserver', HttpServer],
    ['fixture:credentials', CredentialsFixture],
    ['fixture:session-query', SessionQueryFixture],
    ['@voyaseek-ai/dsh-mobile-view', MobileView],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('mobile-view real composition', () => {
  it('serves the page and only exposes bounded message data with a bearer header', { timeout: 60_000 }, async () => {
    const remotePort = await freePort()
    const loaded = await loadComposition(remotePort)
    const origin = `http://127.0.0.1:${String(loaded.webServer.port)}`

    const page = await fetch(`${origin}/mobile-view`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Voyaseek Mobile View')

    expect((await fetch(`${origin}/mobile-view/api/sessions?token=test-token`)).status).toBe(401)
    expect((await fetch(`${origin}/mobile-view/api/sessions`, { method: 'POST' })).status).toBe(405)

    const auth = { authorization: 'Bearer test-token' }
    const sessions = await fetch(`${origin}/mobile-view/api/sessions`, { headers: auth })
    expect(sessions.status).toBe(200)
    expect(await sessions.json()).toEqual({
      sessions: [{ sessionId: 'newest', createdAt: 2, title: 'Mobile title' }],
    })
    expect(sessions.headers.get('cache-control')).toBe('no-store')

    const messages = await fetch(`${origin}/mobile-view/api/session?sessionId=newest`, { headers: auth })
    expect(messages.status).toBe(200)
    expect(await messages.json()).toEqual({
      sessionId: 'newest',
      messages: [{ seq: 2, time: 12, role: 'assistant', text: 'world' }],
    })

    const remoteOrigin = `http://127.0.0.1:${String(remotePort)}`
    expect((await fetch(`${remoteOrigin}/mobile-view`)).status).toBe(200)
    expect((await fetch(`${remoteOrigin}/api`)).status).toBe(404)
    expect((await fetch(`${remoteOrigin}/mobile-view/api/sessions`, { headers: auth })).status).toBe(200)
  })
})
