import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertPortAvailable,
  browserCommand,
  formatAcceptWebStatus,
  parseAcceptWebArgs,
  selectAcceptWebPort,
  waitForWebApplication,
  writeAcceptWebReport,
} from './accept-web.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('accept:web arguments', () => {
  it('uses the stable AiDesktop development port and opens the browser by default', () => {
    expect(parseAcceptWebArgs([])).toEqual({
      port: 3081,
      allowPortFallback: true,
      openBrowser: true,
      smoke: false,
    })
  })

  it('accepts an explicit port and headless hand-off', () => {
    expect(parseAcceptWebArgs(['--port=4123', '--no-open'])).toEqual({ port: 4123, allowPortFallback: false, openBrowser: false, smoke: false })
    expect(parseAcceptWebArgs(['--port', '4124'])).toEqual({ port: 4124, allowPortFallback: false, openBrowser: true, smoke: false })
    expect(parseAcceptWebArgs(['--', '--port', '4125'])).toEqual({ port: 4125, allowPortFallback: false, openBrowser: true, smoke: false })
  })

  it('makes smoke headless and writes reports only to an explicit directory', () => {
    expect(parseAcceptWebArgs(['--smoke', '--', '--report-dir', '/tmp/aidesktop-report'])).toEqual({
      port: 3081,
      allowPortFallback: true,
      openBrowser: false,
      smoke: true,
      reportDir: '/tmp/aidesktop-report',
    })
  })

  it('rejects missing, invalid, and unknown values', () => {
    expect(() => parseAcceptWebArgs(['--port'])).toThrow('--port must be followed by an integer')
    expect(() => parseAcceptWebArgs(['--report-dir'])).toThrow('--report-dir must be followed by a directory')
    expect(() => parseAcceptWebArgs(['--report-dir='])).toThrow('--report-dir must not be empty')
    expect(() => parseAcceptWebArgs(['--port', '0'])).toThrow('--port must be between 1 and 65535')
    expect(() => parseAcceptWebArgs(['--fast'])).toThrow('unknown argument')
  })
})

it('writes a credential-free report and concise log to the selected directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aidesktop-accept-web-'))
  try {
    const paths = await writeAcceptWebReport(directory, {
      version: 1,
      commitSha: '69dddda000000000000000000000000000000000',
      workingTree: 'dirty',
      url: 'http://127.0.0.1:3081',
      startedAt: '2026-08-20T01:00:00.000Z',
      completedAt: '2026-08-20T01:01:00.000Z',
      result: 'passed',
      checks: [
        { name: 'port', status: 'passed' },
        { name: 'build', status: 'passed' },
        { name: 'client-watcher', status: 'passed' },
        { name: 'host', status: 'passed' },
        { name: 'readiness', status: 'passed' },
      ],
      screenshots: [],
    })
    const json = await readFile(paths.jsonPath, 'utf8')
    const log = await readFile(paths.logPath, 'utf8')
    expect(JSON.parse(json)).toMatchObject({
      result: 'passed',
      commitSha: '69dddda000000000000000000000000000000000',
      workingTree: 'dirty',
    })
    expect(log).toContain('Check readiness: passed')
    expect(`${json}${log}`).not.toContain('API_KEY')
  } finally {
    await rm(directory, { recursive: true })
  }
})

it('prints explicit lifecycle states and publishes the URL only when ready', () => {
  const url = 'http://127.0.0.1:3081'
  expect(formatAcceptWebStatus('building')).toBe('执行状态：构建中')
  expect(formatAcceptWebStatus('starting')).toBe('执行状态：启动中')
  expect(formatAcceptWebStatus('ready', url)).toBe(`执行状态：已就绪\nWeb 地址：${url}`)
  expect(formatAcceptWebStatus('stopped')).toBe('执行状态：已停止')
  expect(formatAcceptWebStatus('failed')).toBe('执行状态：失败')
})

it('selects shell-free browser commands for supported desktop platforms', () => {
  const url = 'http://127.0.0.1:3081'
  expect(browserCommand(url, 'darwin')).toEqual({ command: 'open', args: [url] })
  expect(browserCommand(url, 'win32')).toEqual({ command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] })
  expect(browserCommand(url, 'linux')).toEqual({ command: 'xdg-open', args: [url] })
  expect(browserCommand(url, 'aix')).toBeUndefined()
})

it('waits for the assembled Web boot payload instead of any HTTP success', async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response('not ready', { status: 503 }))
    .mockResolvedValueOnce(new Response('<html>bare Vite shell</html>', { status: 200 }))
    .mockResolvedValueOnce(new Response('<script>window.__DSH_BOOT__ = {}</script>', { status: 200 }))

  await waitForWebApplication('http://127.0.0.1:3081', new AbortController().signal, request)

  expect(request).toHaveBeenCalledTimes(3)
})

it('rejects a port already owned by another process', async () => {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port')
  try {
    await expect(assertPortAvailable(address.port)).rejects.toThrow(`port ${String(address.port)} is unavailable`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }))
  }
})

it('falls forward from an occupied default port but keeps an explicit port exact', async () => {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('test server did not bind a TCP port')
  try {
    await expect(selectAcceptWebPort(address.port, false)).rejects.toThrow(`port ${String(address.port)} is unavailable`)
    expect(await selectAcceptWebPort(address.port, true)).toBeGreaterThan(address.port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    }))
  }
})
