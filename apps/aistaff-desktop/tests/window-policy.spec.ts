import { describe, expect, it } from 'vitest'
import { createWindowOptions, isDirectProxyResolution, isRuntimeDocument } from '../src/window-policy.js'

describe('renderer security policy', () => {
  it('uses an isolated sandbox without Node or webviews', () => {
    expect(createWindowOptions('/app.asar/dist/preload.js').webPreferences).toMatchObject({
      preload: '/app.asar/dist/preload.js',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    })
  })

  it('accepts documents only from the managed loopback origin', () => {
    const runtime = new URL('http://127.0.0.1:54100')
    expect(isRuntimeDocument('http://127.0.0.1:54100/conversations/1', runtime)).toBe(true)
    expect(isRuntimeDocument('http://localhost:54100/', runtime)).toBe(false)
    expect(isRuntimeDocument('http://127.0.0.1:54101/', runtime)).toBe(false)
    expect(isRuntimeDocument('https://127.0.0.1:54100/', runtime)).toBe(false)
    expect(isRuntimeDocument('http://user@127.0.0.1:54100/', runtime)).toBe(false)
  })

  it('accepts only direct-only proxy resolutions for the loopback renderer', () => {
    expect(isDirectProxyResolution('DIRECT')).toBe(true)
    expect(isDirectProxyResolution('direct; DIRECT')).toBe(true)
    expect(isDirectProxyResolution('DIRECT; PROXY proxy.example:8080')).toBe(false)
    expect(isDirectProxyResolution('PROXY proxy.example:8080; DIRECT')).toBe(false)
    expect(isDirectProxyResolution('DIRECT\nPROXY injected.example:8080')).toBe(false)
    expect(isDirectProxyResolution('')).toBe(false)
  })
})
