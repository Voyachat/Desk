/** Keyless browser flow for the additive AI employee product bundle. */

import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const AISTAFF_PRODUCT_OVERLAY = fileURLToPath(new URL(
  '../../../packages/aistaff/product-bundle/cordis.patch.yml',
  import.meta.url,
))
const AISTAFF_PRODUCT_ANCHOR = fileURLToPath(new URL(
  '../../../packages/aistaff/product-bundle/package.json',
  import.meta.url,
))
const TASK_TITLE = '整理本周客户反馈'

describe('web e2e: AI employee product flow', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole> | undefined

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: AISTAFF_PRODUCT_OVERLAY,
      extraInstallAnchors: [AISTAFF_PRODUCT_ANCHOR],
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    try {
      expect(tripwire?.pageErrors ?? []).toEqual([])
      expect(tripwire?.warnings ?? []).toEqual([])
    } catch (error) {
      failures.push(error)
    }
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'AI employee flow cleanup failed')
  })

  it('keeps the DSH shell and creates, approves, receipts, and closes one task', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-aistaff-product'))

    const sessions = page.getByRole('tree', { name: 'Sessions' })
    await sessions.waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: '打开 AI 员工工作台' }).click()

    const dialog = page.getByRole('dialog', { name: 'AI 员工' })
    await dialog.waitFor({ timeout: 15_000 })
    const employeeSelect = dialog.getByLabel('选择员工')
    expect(await employeeSelect.inputValue()).toBe('local-assistant')
    expect(await employeeSelect.textContent()).toContain('本地助理 · 可用')
    await dialog.getByText('本地基础问题处理', { exact: true }).waitFor()

    await dialog.getByRole('textbox', { name: '任务标题' }).fill(TASK_TITLE)
    await dialog.getByRole('button', { name: '创建任务' }).click()

    const approvalSection = dialog.locator('section[aria-labelledby="aistaff-approval-title"]')
    await approvalSection.getByText(TASK_TITLE, { exact: false }).waitFor()
    await approvalSection.getByText('中风险', { exact: true }).waitFor()
    const taskSection = dialog.locator('section[aria-labelledby="aistaff-task-title"]')
    await taskSection.getByText('等待审批', { exact: true }).waitFor()

    await approvalSection.getByRole('button', { name: '批准' }).click()

    await approvalSection.getByText('当前没有待审批任务', { exact: true }).waitFor()
    await taskSection.getByText(TASK_TITLE, { exact: true }).waitFor()
    await taskSection.getByText('已批准', { exact: true }).waitFor()
    const receiptSection = dialog.locator('section[aria-labelledby="aistaff-receipt-title"]')
    await receiptSection.getByText('已批准', { exact: true }).waitFor()

    await dialog.getByRole('button', { name: '关闭 AI 员工工作台' }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect(await sessions.isVisible()).toBe(true)
  }, 90_000)
})
