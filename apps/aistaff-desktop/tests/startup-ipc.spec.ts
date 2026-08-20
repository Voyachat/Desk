import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import {
  assertTrustedStartupSender,
  parseStartupIntent,
  STARTUP_DRAFT_MAX_LENGTH,
} from '../src/startup-ipc.js'

describe('desktop startup IPC', () => {
  it('accepts only bounded drafts and fixed agent presets', () => {
    expect(parseStartupIntent({ draft: '开始工作', agentPreset: 'code' })).toEqual({
      draft: '开始工作',
      agentPreset: 'code',
    })
    expect(() => parseStartupIntent({
      draft: 'x'.repeat(STARTUP_DRAFT_MAX_LENGTH + 1),
      agentPreset: 'standard',
    })).toThrow(RangeError)
    expect(() => parseStartupIntent({ draft: '', agentPreset: 'untrusted' })).toThrow(TypeError)
  })

  it('requires the owned main frame and an allowlisted document URL', () => {
    const startupUrl = new URL('file:///Applications/Voyaseek.app/Contents/Resources/app.asar/assets/startup.html')
    const runtimeUrl = new URL('http://127.0.0.1:53100/')
    const mainFrame = { parent: null, processId: 7, routingId: 9 }
    const webContents = { mainFrame }
    const window = { webContents } as unknown as BrowserWindow
    const trusted = {
      sender: webContents,
      senderFrame: { ...mainFrame, url: startupUrl.href },
    } as unknown as IpcMainInvokeEvent

    expect(() => assertTrustedStartupSender(trusted, window, startupUrl, runtimeUrl)).not.toThrow()
    expect(() => assertTrustedStartupSender({
      ...trusted,
      senderFrame: { ...mainFrame, parent: {}, url: startupUrl.href },
    } as unknown as IpcMainInvokeEvent, window, startupUrl, runtimeUrl)).toThrow()
    expect(() => assertTrustedStartupSender({
      ...trusted,
      senderFrame: { ...mainFrame, url: 'https://example.com/' },
    } as unknown as IpcMainInvokeEvent, window, startupUrl, runtimeUrl)).toThrow()
  })
})
