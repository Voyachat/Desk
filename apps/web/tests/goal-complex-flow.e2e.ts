import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@voyaseek-ai/dsh-session'
import {
  assertFixtureInventory,
  captureStableAria,
  compareOrRefreshGolden,
  launchWebScaffold,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/goal-complex-flow', import.meta.url))
const PARENT_FIXTURE = fileURLToPath(new URL(
  './snapshots/goal-complex-flow/root.jsonl', import.meta.url,
))
const CHILD_FIXTURES = ['manager.jsonl', 'executor.jsonl', 'auditor.jsonl']
  .map(file => fileURLToPath(new URL(`./snapshots/goal-complex-flow/${file}`, import.meta.url)))
const UI_EXPECTED = fileURLToPath(new URL(
  './snapshots/goal-complex-flow/ui.expected.md', import.meta.url,
))
const MODE = webSnapshotMode()

function waitForRootTurn(scaffold: WebScaffold, timeoutMs: number): Promise<SessionId> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off()
      reject(new Error(`no root turn/end within ${timeoutMs}ms`))
    }, timeoutMs)
    const off = scaffold.ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || session.header.parentSession !== undefined) return
      clearTimeout(timer)
      off()
      scaffold.ctx.sessions.flush(session).then(() => resolve(session.id), reject)
    })
  })
}

describe('web e2e: independently audited complex goal', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      replayFixture: PARENT_FIXTURE,
      replayChildFixtures: CHILD_FIXTURES,
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('selects the complex task tool from ordinary language and shows the Auditor rejection', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-complex-flow'))
    const input = page.locator('textarea').first()
    const rootTurnSettled = waitForRootTurn(scaffold, 30_000)
    await input.fill('Independently complete and verify the multi-stage task: prove that deliverable.txt exists.')
    await input.press('Enter')

    await expect.poll(() => input.inputValue()).toBe('')
    const rootId = await rootTurnSettled

    const root = scaffold.ctx.sessions.get(rootId)
    if (root === undefined) {
      throw new Error(`complex-goal snapshot did not create a root session: ${JSON.stringify(
        scaffold.ctx.sessions.list().map(session => ({
          id: session.id,
          parent: session.header.parentSession,
          events: session.events.map(event => event.type === 'tool/call'
            ? `${event.type}:${event.data.name}`
            : event.type),
        })),
      )}`)
    }
    expect(root.events.some(event => event.type === 'tool/call' && event.data.name === 'complex_goal')).toBe(true)
    if (!root.events.some(event => event.type === 'complex-goal/change')) {
      const result = root.events.find(event => event.type === 'tool/result')
      throw new Error(`complex_goal did not start: ${JSON.stringify(result?.data)}`)
    }
    await expect.poll(() => page.getByText('Blocked Goal', { exact: true }).count()).toBe(1)
    const changes = root.events.filter(event => event.type === 'complex-goal/change')
    expect(changes.map(event => event.data.snapshot.phase)).toEqual([
      'planning', 'executing', 'auditing', 'blocked',
    ])
    expect(changes.at(-1)?.data.snapshot.latestAudit?.summary)
      .toBe('The claimed deliverable does not exist.')
    expect(root.events.some(event => event.type === 'request/header')).toBe(true)
    await expect.poll(() => page.getByText(
      'Independent verification blocked completion because deliverable.txt is absent.',
      { exact: true },
    ).count()).toBe(1)

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'auditor.jsonl', 'executor.jsonl', 'manager.jsonl', 'root.jsonl', 'ui.expected.md',
    ])
  }, 60_000)
})
