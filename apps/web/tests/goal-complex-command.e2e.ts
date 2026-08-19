import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import {
  connectFreshWorkspaceZh,
  saveFailureShot,
  ZH_BROWSER_LOCALE,
} from './support.ts'

describe('web e2e: complex goal command launcher', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const events: { readonly type: string }[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('places 复杂任务目标 in the plus command menu and claims its input without executing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-complex-launcher'))
    const input = page.locator('textarea').first()
    const commandRunsBefore = events.filter(event => event.type === 'command/run').length
    const requestsBefore = events.filter(event => event.type === 'request/header').length

    await page.getByRole('button', { name: '命令', exact: true }).click()
    const menu = page.getByRole('listbox', { name: '触发候选建议' })
    await menu.waitFor({ timeout: 10_000 })
    const option = menu.getByRole('option', { name: /^复杂任务目标/u })
    await expect.poll(() => option.count()).toBe(1)

    await option.click()
    await expect.poll(() => input.inputValue()).toBe('/goal-complex ')
    await expect.poll(() => menu.count()).toBe(0)
    expect(events.filter(event => event.type === 'command/run')).toHaveLength(commandRunsBefore)
    expect(events.filter(event => event.type === 'request/header')).toHaveLength(requestsBefore)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
