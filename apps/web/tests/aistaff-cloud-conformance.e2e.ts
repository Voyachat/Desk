/** Keyless browser flow for the test-only Cloud Client Gateway conformance bundle. */

import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const CLOUD_CONFORMANCE_OVERLAY = fileURLToPath(new URL(
  '../../../packages/aistaff/cloud-conformance-bundle/cordis.patch.yml',
  import.meta.url,
))
const CLOUD_CONFORMANCE_ANCHOR = fileURLToPath(new URL(
  '../../../packages/aistaff/cloud-conformance-bundle/package.json',
  import.meta.url,
))
const EMPLOYEE_INPUT = '分析本周客户反馈并生成一份安全摘要'

describe('web e2e: Cloud AI employee conformance flow', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole> | undefined
  const consoleProblems: string[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: CLOUD_CONFORMANCE_OVERLAY,
      extraInstallAnchors: [CLOUD_CONFORMANCE_ANCHOR],
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') {
        consoleProblems.push(`${message.type()}: ${message.text()}`)
      }
    })
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error) {
      await saveFailureShot(page, 'web-e2e-aistaff-cloud-conformance-boot')
      const body = (await page.locator('body').innerText()).slice(0, 2_000)
      throw new Error(
        `Cloud conformance Client did not render the DSH frame; pageErrors=${JSON.stringify(tripwire.pageErrors)}`
        + ` console=${JSON.stringify(consoleProblems)} body=${JSON.stringify(body)}`,
        { cause: error },
      )
    }
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    try {
      expect(tripwire?.pageErrors ?? []).toEqual([])
      expect(tripwire?.warnings ?? []).toEqual([])
      expect(consoleProblems).toEqual([])
    } catch (error) {
      failures.push(error)
    }
    await page?.close().catch((error: unknown) => failures.push(error))
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'Cloud AI employee conformance cleanup failed')
  })

  it('keeps the DSH shell and restores employee, activity, safe material, approval, and receipt projection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-aistaff-cloud-conformance'))

    const sessions = page.getByRole('tree', { name: 'Sessions' })
    await sessions.waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: '打开 AI 员工工作台' }).click()

    let dialog = page.getByRole('dialog', { name: 'AI 员工' })
    await dialog.waitFor({ timeout: 15_000 })
    const employeeSelect = dialog.locator('section[aria-labelledby="aistaff-cloud-employee-title"] select')
    await expect.poll(() => employeeSelect.textContent(), { timeout: 20_000 }).toContain('· 可用')
    await dialog.getByText('测试专用 Client Gateway conformance 员工', { exact: true }).waitFor()
    const readyEmployee = employeeSelect.locator('option').filter({ hasText: '· 可用' }).first()
    const employeeRef = await readyEmployee.getAttribute('value')
    if (employeeRef === null || employeeRef === '') throw new Error('Cloud conformance employee has no opaque value')
    await employeeSelect.selectOption(employeeRef)

    await dialog.getByRole('button', { name: '新建协作' }).click()
    const engagementSelect = dialog.locator('section[aria-labelledby="aistaff-cloud-engagement-title"] select')
    await expect.poll(() => engagementSelect.inputValue(), { timeout: 15_000 }).not.toBe('')
    const engagementRef = await engagementSelect.inputValue()
    await engagementSelect.selectOption(engagementRef)

    const composer = dialog.getByLabel('给 AI 员工发送消息', { exact: true })
    await expect.poll(() => composer.isEnabled(), { timeout: 15_000 }).toBe(true)
    await composer.fill(EMPLOYEE_INPUT)
    await dialog.getByRole('button', { name: '发送', exact: true }).click()

    const activitySection = dialog.locator('section[aria-labelledby="aistaff-cloud-activity-title"]')
    await activitySection.getByText('等待你的回复', { exact: true }).waitFor({ timeout: 20_000 })
    const materialSection = dialog.locator('section[aria-labelledby="aistaff-cloud-material-title"]')
    await materialSection.locator('article').first().waitFor({ timeout: 20_000 })
    await materialSection.getByText('可用', { exact: true }).waitFor()
    expect(await materialSection.locator('script, img, iframe, object, embed').count()).toBe(0)

    const interactionSection = dialog.locator('section[aria-labelledby="aistaff-cloud-interaction-title"]')
    await interactionSection.getByText('企业审批 · Cloud', { exact: true }).waitFor({ timeout: 20_000 })
    await interactionSection.getByRole('button', { name: '批准', exact: true }).click()

    await activitySection.getByText('已完成', { exact: true }).waitFor({ timeout: 20_000 })
    await interactionSection.getByText('当前没有需要你处理的请求', { exact: true }).waitFor({ timeout: 20_000 })
    const receiptSection = dialog.locator('section[aria-labelledby="aistaff-cloud-receipt-title"]')
    await receiptSection.getByText('已完成', { exact: true }).waitFor({ timeout: 20_000 })

    const materialProjection = await materialSection.textContent()
    expect(materialProjection).not.toBeNull()
    expect((await dialog.textContent())?.toLowerCase()).not.toContain('fixture')

    await dialog.getByRole('button', { name: '关闭 AI 员工工作台' }).click()
    await dialog.waitFor({ state: 'hidden' })
    expect(await sessions.isVisible()).toBe(true)

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('tree', { name: 'Sessions' }).waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: '打开 AI 员工工作台' }).click()
    dialog = page.getByRole('dialog', { name: 'AI 员工' })
    await dialog.waitFor({ timeout: 15_000 })

    await expect.poll(
      () => dialog.locator('section[aria-labelledby="aistaff-cloud-employee-title"] select').inputValue(),
      { timeout: 20_000 },
    ).toBe(employeeRef)
    await expect.poll(
      () => dialog.locator('section[aria-labelledby="aistaff-cloud-engagement-title"] select').inputValue(),
      { timeout: 20_000 },
    ).toBe(engagementRef)
    const restoredActivity = dialog.locator('section[aria-labelledby="aistaff-cloud-activity-title"]')
    await restoredActivity.getByText('已完成', { exact: true }).waitFor({ timeout: 20_000 })
    const restoredMaterial = dialog.locator('section[aria-labelledby="aistaff-cloud-material-title"]')
    await expect.poll(() => restoredMaterial.textContent(), { timeout: 20_000 }).toBe(materialProjection)
    const restoredInteraction = dialog.locator('section[aria-labelledby="aistaff-cloud-interaction-title"]')
    await restoredInteraction.getByText('当前没有需要你处理的请求', { exact: true }).waitFor({ timeout: 20_000 })
    const restoredReceipt = dialog.locator('section[aria-labelledby="aistaff-cloud-receipt-title"]')
    await restoredReceipt.getByText('已完成', { exact: true }).waitFor({ timeout: 20_000 })
    expect((await dialog.textContent())?.toLowerCase()).not.toContain('fixture')
    expect(await page.getByRole('tree', { name: 'Sessions' }).isVisible()).toBe(true)
  }, 120_000)
})
