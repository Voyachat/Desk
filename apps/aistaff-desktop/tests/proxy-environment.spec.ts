import { describe, expect, it, vi } from 'vitest'
import { resolveProxyEnvironment } from '../src/proxy-environment.js'

const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com/'
const DASHSCOPE_API_URL = 'https://dashscope.aliyuncs.com/'

describe('desktop child proxy environment', () => {
  it('returns an empty overlay for a direct connection', async () => {
    const resolveProxy = vi.fn(async () => 'DIRECT')

    await expect(resolveProxyEnvironment(resolveProxy, {})).resolves.toEqual({})
    expect(resolveProxy).toHaveBeenCalledWith(GOOGLE_API_URL)
    expect(resolveProxy).toHaveBeenCalledWith(DASHSCOPE_API_URL)
  })

  it.each(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const)(
    'keeps an explicitly inherited %s without resolving the system proxy',
    async (variable) => {
      const resolveProxy = vi.fn(async () => 'PROXY system-proxy.example:8080')
      const inherited = Object.freeze({
        [variable]: 'http://explicit-user:explicit-secret@explicit-proxy.example:3128',
        NO_PROXY: 'metadata.google.internal',
      })

      const overlay = await resolveProxyEnvironment(resolveProxy, inherited)

      expect(resolveProxy).not.toHaveBeenCalled()
      expect(overlay).toEqual({
        NODE_USE_ENV_PROXY: '1',
        NO_PROXY: 'metadata.google.internal,127.0.0.1,localhost',
        no_proxy: 'metadata.google.internal,127.0.0.1,localhost',
      })
      expect(JSON.stringify(overlay)).not.toContain('explicit-user')
      expect(JSON.stringify(overlay)).not.toContain('explicit-secret')
    },
  )

  it.each([
    ['PROXY proxy.example:8080', 'http://proxy.example:8080'],
    ['HTTPS secure-proxy.example:8443', 'https://secure-proxy.example:8443'],
    ['PROXY [2001:db8::1]:3128', 'http://[2001:db8::1]:3128'],
  ])('maps %s to Node HTTP and HTTPS proxy variables', async (resolution, expectedProxy) => {
    const overlay = await resolveProxyEnvironment(async () => resolution, {})

    expect(overlay).toEqual({
      HTTP_PROXY: expectedProxy,
      HTTPS_PROXY: expectedProxy,
      NODE_USE_ENV_PROXY: '1',
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    })
  })

  it('does not skip an unsupported leading PAC candidate', async () => {
    const resolution = [
      'SOCKS5 socks.example:1080',
      'HTTPS first-proxy.example:8443',
      'PROXY second-proxy.example:8080',
      'DIRECT',
    ].join('; ')

    const overlay = await resolveProxyEnvironment(async () => resolution, {})

    expect(overlay).toEqual({})
  })

  it('honors a leading DIRECT PAC result instead of forcing a fallback proxy', async () => {
    await expect(resolveProxyEnvironment(
      async () => 'DIRECT; PROXY fallback.example:8080',
      {},
    )).resolves.toEqual({})
  })

  it('does not apply one provider domain proxy to a differently routed provider', async () => {
    await expect(resolveProxyEnvironment(
      async url => url === GOOGLE_API_URL ? 'PROXY google.example:8080' : 'PROXY qwen.example:8080',
      {},
    )).resolves.toEqual({})
  })

  it('keeps the local desktop available when system proxy resolution fails', async () => {
    await expect(resolveProxyEnvironment(
      async () => { throw new Error('system proxy unavailable') },
      {},
    )).resolves.toEqual({})
  })

  it('bounds a system PAC lookup that never settles', async () => {
    const pending = new Promise<string>(() => {})

    await expect(resolveProxyEnvironment(() => pending, {}, 5)).resolves.toEqual({})
  })

  it.each([
    'SOCKS5 socks.example:1080',
    'PROXY user:secret@proxy.example:8080',
    'PROXY proxy.example:8080/path',
    'PROXY proxy.example:not-a-port',
    'PROXY proxy.example:65536',
    'PROXY 999.999.999.999:8080',
    'PROXY safe.example:8080\r\nHTTPS injected.example:8443',
  ])('does not expose an unsupported or malformed proxy from %j', async (resolution) => {
    await expect(resolveProxyEnvironment(async () => resolution, {})).resolves.toEqual({})
  })

  it('merges loopback exclusions into an inherited NO_PROXY without duplicates', async () => {
    const inherited = Object.freeze({
      NO_PROXY: 'metadata.google.internal,LOCALHOST',
    })

    const overlay = await resolveProxyEnvironment(
      async () => 'PROXY proxy.example:8080',
      inherited,
    )

    expect(overlay.NO_PROXY).toBe('metadata.google.internal,LOCALHOST,127.0.0.1')
    expect(overlay.no_proxy).toBe('metadata.google.internal,LOCALHOST,127.0.0.1')
    expect(inherited.NO_PROXY).toBe('metadata.google.internal,LOCALHOST')
  })

  it('overrides an inherited lowercase no_proxy with the same merged loopback exclusions', async () => {
    const overlay = await resolveProxyEnvironment(
      async () => 'PROXY proxy.example:8080',
      { no_proxy: 'metadata.google.internal' },
    )

    expect(overlay.NO_PROXY).toBe('metadata.google.internal,127.0.0.1,localhost')
    expect(overlay.no_proxy).toBe('metadata.google.internal,127.0.0.1,localhost')
  })
})
