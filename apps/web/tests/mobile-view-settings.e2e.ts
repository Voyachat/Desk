// Web e2e scenario: a local user configures the dedicated authenticated,
// read-only phone listener from Settings and reaches only its bounded routes.

import { createServer } from 'node:http'
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { ZH_BROWSER_LOCALE, saveFailureShot } from './support.ts'

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mobile-view e2e has no TCP port')
  await new Promise<void>((resolve, reject) => server.close(error => {
    if (error === undefined) resolve()
    else reject(error)
  }))
  return address.port
}

describe('web e2e: mobile remote view settings', () => {
  it('enables, authenticates, and stops the dedicated read-only listener', async () => {
    let scaffold: WebScaffold | undefined
    let browser: Browser | undefined
    try {
      scaffold = await launchWebScaffold({})
      browser = await chromium.launch()
      const page = await browser.newPage({
        viewport: { width: 1680, height: 1000 },
        locale: ZH_BROWSER_LOCALE,
      })
      onTestFailed(() => saveFailureShot(page, 'web-e2e-mobile-view-settings'))
      const tripwire = watchConsole(page)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.getByRole('button', { name: '远程查看', exact: true }).click()
      await dialog.getByRole('heading', { name: '手机远程查看' }).waitFor({ timeout: 10_000 })
      expect(tripwire.pageErrors).toEqual([])

      const port = await freePort()
      const portInput = dialog.getByLabel('监听端口')
      await portInput.fill(String(port))
      await dialog.getByRole('button', { name: '保存端口' }).click()
      await expect.poll(() => portInput.inputValue(), { timeout: 10_000 }).toBe(String(port))

      await dialog.getByRole('button', { name: '开启远程查看' }).click()
      await dialog.getByText('远程查看已开启', { exact: true }).waitFor({ timeout: 10_000 })
      const tokenNode = dialog.getByText(/^[0-9a-f]{64}$/)
      await tokenNode.waitFor({ timeout: 10_000 })
      const token = await tokenNode.textContent()
      expect(token).toMatch(/^[0-9a-f]{64}$/)

      const remoteOrigin = `http://127.0.0.1:${String(port)}`
      await expect.poll(async () => (await fetch(`${remoteOrigin}/mobile-view`)).status, { timeout: 10_000 })
        .toBe(200)
      expect((await fetch(`${remoteOrigin}/api`)).status).toBe(404)
      expect((await fetch(`${remoteOrigin}/mobile-view/api/status`)).status).toBe(404)
      const sessions = await fetch(`${remoteOrigin}/mobile-view/api/sessions`, {
        headers: { authorization: `Bearer ${token ?? ''}` },
      })
      expect(sessions.status).toBe(200)
      expect(await sessions.json()).toEqual({ sessions: [] })

      await dialog.getByRole('button', { name: '关闭远程查看' }).click()
      await dialog.getByText('远程查看未开启', { exact: true }).waitFor({ timeout: 10_000 })
      await expect.poll(
        () => fetch(`${remoteOrigin}/mobile-view`).then(() => 'listening', () => 'closed'),
        { timeout: 10_000 },
      ).toBe('closed')
      expect(tripwire.pageErrors).toEqual([])
    } finally {
      await browser?.close()
      await scaffold?.close()
    }
  }, 120_000)
})
