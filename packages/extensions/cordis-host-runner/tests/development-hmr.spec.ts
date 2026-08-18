/** @vitest-environment jsdom */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@voyaseek-ai/cordis'
import type { Fiber } from '@voyaseek-ai/cordis'
import type { Loader } from '@voyaseek-ai/cordis-plugin-loader'
import type { ClientModuleSystem } from '@voyaseek-ai/dsh-client-modules/client'
import { SlotRegistry } from '@voyaseek-ai/dsh-client-runtime/client'
import { DynamicCordisPackageRunner } from '../../cordis-client-runner/src/client/runtime.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DYNAMIC_CORDIS_STORE_DIRECTORY } from '../src/persistence.ts'
import { AGENT_A, setup } from './helpers.ts'

const homes = new Set<string>()

afterEach(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  homes.clear()
})

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-dynamic-hmr-'))
  homes.add(home)
  return home
}

async function bootClient(): Promise<{
  ctx: Context
  slots: SlotRegistry
  runner: DynamicCordisPackageRunner
  removed: string[]
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const factories = new Map<string, () => unknown>()
  const fibers = new Map<string, { fiber: Fiber }>()
  const removed: string[] = []
  let next = 0
  ;(globalThis as { __ModuleLoader__?: unknown }).__ModuleLoader__ = {
    load: (handoff: { id: string; factory: () => unknown }) => { factories.set(handoff.id, handoff.factory) },
  }
  const loader = {
    create: (options: { name: string }) => {
      const factory = factories.get(options.name)
      if (factory === undefined) throw new Error(`no factory for ${options.name}`)
      const entryId = `entry-${++next}`
      const fiber = ctx.plugin(factory() as Parameters<Context['plugin']>[0])
      void Promise.resolve(fiber).catch(() => {})
      fibers.set(entryId, { fiber })
      return Promise.resolve(entryId)
    },
    resolve: (entryId: string) => fibers.get(entryId) ?? { fiber: undefined },
    remove: async (entryId: string) => {
      removed.push(entryId)
      const entry = fibers.get(entryId)
      fibers.delete(entryId)
      await entry?.fiber.dispose()
    },
  } as unknown as Loader
  const modules = { invalidate() {} } as unknown as ClientModuleSystem
  const runner = new DynamicCordisPackageRunner({
    ctx,
    loader,
    modules,
    slots: ctx.slots,
    invoke: () => Promise.resolve(null),
    reportGuardFailure() {},
    reportRenderFailure() {},
  })
  return { ctx, slots: ctx.slots, runner, removed }
}

describe('dynamic Cordis development working-copy HMR', () => {
  it('keeps the live artifact on a bad edit, then publishes and hot-reloads the fixed TSX file', async () => {
    const dshHome = temporaryHome()
    const harness = await setup({ dshHome, developmentHmr: true, developmentHmrPollMs: 10 }, [AGENT_A])
    const client = await bootClient()
    harness.gateway.answer = 'approve'
    harness.gateway.approveFutureVersions = true
    let heldSecond: Promise<void> | undefined
    let clientLoads = 0
    harness.gateway.loadClient = async (source) => {
      clientLoads += 1
      if (heldSecond !== undefined && clientLoads === 2) await heldSecond
      const result = await client.runner.load({ ...source, agentId: AGENT_A.id })
      return result.ok
        ? { ok: true, ...result.waitingFor === undefined ? {} : { waitingFor: result.waitingFor } }
        : { ok: false, message: result.message, ...result.stack === undefined ? {} : { stack: result.stack } }
    }
    const firstSource = `
      interface LabelProps { text: string }
      const Label = ({ text }: LabelProps) => <strong>{text}</strong>
      return {
        inject: ['slots'],
        apply(ctx) { ctx.slots.register({ name: 'root' }, () => <Label text="first" />) },
      }
    `
    const defined = harness.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'tsx' },
      name: 'Editable TSX',
      purpose: 'prove file build and safe live replacement',
      code: { client: firstSource },
    })
    const initialRun = await harness.runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run')
    expect(initialRun).toMatchObject({ ok: true, status: 'awaiting-approval' })
    await harness.gateway.answering
    const firstInventory = harness.runner.inventory()[0]
    const firstActivation = firstInventory?.activeRun
    expect(firstInventory).toMatchObject({
      currentPackageId: defined.packageId,
      developmentSources: {
        client: '$VOYASEEK_HOME/dynamic-cordis/sources/tsx-1/client.tsx',
      },
    })
    expect(firstActivation?.packageId).toBe(defined.packageId)
    expect(client.runner.getSnapshot()[0]).toMatchObject({ packageId: defined.packageId })
    const [firstEntry] = client.slots.entries('root')
    const firstComponent = firstEntry?.component as (() => { type: unknown; props: Record<string, unknown> }) | undefined
    const firstElement = firstComponent?.()
    expect(firstElement?.type).toBeTypeOf('function')
    if (firstElement === undefined) throw new Error('first dynamic client component did not render')
    const firstRendered = (firstElement.type as (props: unknown) => unknown)(firstElement.props)
    expect(firstRendered).toMatchObject({ type: 'strong', props: { children: 'first' } })

    const sourcePath = join(
      dshHome,
      DYNAMIC_CORDIS_STORE_DIRECTORY,
      'sources',
      String(defined.pluginId),
      'client.tsx',
    )
    const manifestPath = join(dshHome, DYNAMIC_CORDIS_STORE_DIRECTORY, 'registry.json')
    const committed = readFileSync(manifestPath, 'utf8')
    const persistence = (harness.runner as unknown as {
      persistence: { save(snapshot: unknown): void }
    }).persistence
    const save = vi.spyOn(persistence, 'save').mockImplementationOnce(() => {
      throw new Error('manifest commit unavailable')
    })
    expect(() => harness.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'existing', pluginId: defined.pluginId },
      name: 'Must not leak to working copy',
      purpose: 'prove manifest is the only commit point',
      code: { client: 'return { apply() { return <aside>uncommitted</aside> } }' },
    })).toThrow('manifest commit unavailable')
    save.mockRestore()
    expect(readFileSync(sourcePath, 'utf8')).toBe(firstSource)
    expect(readFileSync(manifestPath, 'utf8')).toBe(committed)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(harness.runner.inventory()[0]?.packages).toHaveLength(1)

    writeFileSync(sourcePath, 'return { apply() { return <section>broken</div> } }', 'utf8')

    await vi.waitFor(() => {
      expect(harness.runner.inventory()[0]?.developmentBuildError).toMatchObject({
        sourcePath: '$VOYASEEK_HOME/dynamic-cordis/sources/tsx-1/client.tsx',
        message: expect.stringContaining('code.client TypeScript compile failed') as string,
      })
    })
    expect(readFileSync(manifestPath, 'utf8')).toBe(committed)
    expect(harness.runner.inventory()[0]?.activeRun).toEqual(firstActivation)
    expect(client.slots.entries('root')).toEqual([firstEntry])

    const fixedSource = `
      interface LabelProps { text: string }
      const Label = ({ text }: LabelProps) => <em data-version="second">{text}</em>
      return {
        inject: ['slots'],
        apply(ctx) { ctx.slots.register({ name: 'root' }, () => <Label text="second" />) },
      }
    `
    const secondGate = Promise.withResolvers<undefined>()
    heldSecond = secondGate.promise
    writeFileSync(sourcePath, fixedSource, 'utf8')
    await vi.waitFor(() => {
      const row = harness.runner.inventory()[0]
      expect(row?.packages).toHaveLength(2)
      expect(row?.developmentBuildError).toBeUndefined()
      expect(row?.activeRun?.packageId).toBe(row?.packages[1]?.packageId)
      expect(row?.currentPackageId).toBe(defined.packageId)
    }, { timeout: 2_000 })

    const newestSource = `
      const version: string = 'third'
      return {
        inject: ['slots'],
        apply(ctx) {
          const View = () => <mark data-version={version}>{version}</mark>
          ctx.slots.register({ name: 'root' }, View)
        },
      }
    `
    writeFileSync(sourcePath, newestSource, 'utf8')
    await vi.waitFor(() => {
      expect(harness.runner.inventory()[0]?.packages).toHaveLength(3)
      expect(harness.runner.inventory()[0]?.currentPackageId).toBe(defined.packageId)
    }, { timeout: 2_000 })
    secondGate.resolve(undefined)
    heldSecond = undefined
    await vi.waitFor(() => {
      const row = harness.runner.inventory()[0]
      expect(row?.currentPackageId).toBe(row?.packages[2]?.packageId)
      expect(row?.activeRun?.packageId).toBe(row?.packages[2]?.packageId)
      expect(row?.activeRun?.pluginRunId).not.toBe(firstActivation?.pluginRunId)
    }, { timeout: 2_000 })

    const latest = harness.runner.inventory()[0]?.packages[2]
    if (latest === undefined) throw new Error('development revision was not published')
    expect(harness.runner.inspectPackage(AGENT_A, defined.pluginId, latest.packageId).code.client).toBe(newestSource)
    const entries = client.slots.entries('root')
    expect(entries).toHaveLength(1)
    expect(entries).not.toContain(firstEntry)
    const secondComponent = entries[0]?.component as (() => { type: unknown; props: Record<string, unknown> }) | undefined
    const secondElement = secondComponent?.()
    expect(secondElement).toMatchObject({
      type: 'mark',
      props: { 'data-version': 'third', children: 'third' },
    })
    expect(client.removed).toEqual(['entry-1', 'entry-2'])
    await harness.ctx.fiber.dispose()
    await client.runner.dispose()
    await client.ctx.fiber.dispose()

    const restarted = await setup({ dshHome })
    expect(restarted.runner.inventory()[0]).toMatchObject({
      currentPackageId: latest.packageId,
      packages: [{ packageId: defined.packageId }, {}, { packageId: latest.packageId }],
    })
    expect(restarted.runner.inventory()[0]?.activeRun).toBeUndefined()
    await restarted.ctx.fiber.dispose()
  })
})
