import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CordisDynamicPluginId } from '../src/index.ts'
import { DYNAMIC_CORDIS_STORE_DIRECTORY } from '../src/persistence.ts'
import { AGENT_A, setup } from './helpers.ts'

const homes = new Set<string>()

afterEach(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
  homes.clear()
})

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-dynamic-persistence-'))
  homes.add(home)
  return home
}

describe('dynamic Cordis durable build registry', () => {
  it.each(['root', 'artifacts'] as const)('refuses a symlinked service %s directory before reading or writing', async (entry) => {
    const dshHome = temporaryHome()
    const escaped = join(dshHome, 'escaped')
    mkdirSync(escaped)
    const root = join(dshHome, DYNAMIC_CORDIS_STORE_DIRECTORY)
    if (entry === 'root') {
      symlinkSync(escaped, root, 'dir')
    } else {
      mkdirSync(root)
      symlinkSync(escaped, join(root, 'artifacts'), 'dir')
    }
    await expect(setup({ dshHome })).rejects.toThrow(/must be a non-symlink directory/)
  })

  it('publishes built artifacts, preserves the last usable version on a compile error, and restores stopped', async () => {
    const dshHome = temporaryHome()
    const first = await setup({ dshHome })
    const hostSource = `
      const answer: number = 41
      return {
        name: 'typed-host',
        apply(ctx) {
          ctx.provide('typedAnswer', { value: answer + 1 })
        },
      }
    `
    const defined = first.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'typed' },
      name: 'Typed durable plugin',
      purpose: 'prove build and restart recovery',
      code: { host: hostSource },
    })
    expect(defined.developmentSources).toBeUndefined()
    expect(readFileSync(join(
      dshHome,
      DYNAMIC_CORDIS_STORE_DIRECTORY,
      'sources',
      String(defined.pluginId),
      'host.ts',
    ), 'utf8')).toBe(hostSource)
    await expect(first.runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run'))
      .resolves.toMatchObject({ ok: true, status: 'running', currentPackageId: defined.packageId })
    expect(first.ctx.get('typedAnswer')).toEqual({ value: 42 })

    const manifestPath = join(dshHome, DYNAMIC_CORDIS_STORE_DIRECTORY, 'registry.json')
    const committed = readFileSync(manifestPath, 'utf8')
    const manifest = JSON.parse(committed) as {
      plugins: Array<{
        packages: Array<{ source: { host?: string }; artifacts: { host?: { sha256: string } } }>
      }>
    }
    const stored = manifest.plugins[0]?.packages[0]
    expect(stored?.source.host).toBe(hostSource)
    const artifactDigest = stored?.artifacts.host?.sha256
    expect(artifactDigest).toMatch(/^[a-f0-9]{64}$/)
    const artifact = readFileSync(
      join(dshHome, DYNAMIC_CORDIS_STORE_DIRECTORY, 'artifacts', `${artifactDigest}.js`),
      'utf8',
    )
    expect(artifact).toContain('const answer = 41')
    expect(artifact).not.toContain(': number')

    expect(() => first.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'existing', pluginId: defined.pluginId },
      name: 'Broken source',
      purpose: 'must not publish',
      code: { client: 'const View = () => <section>broken</div>; return () => {}' },
    })).toThrow(/code\.client TypeScript compile failed/)
    expect(readFileSync(manifestPath, 'utf8')).toBe(committed)

    await first.ctx.fiber.dispose()
    const restarted = await setup({ dshHome })
    expect(restarted.runner.inventory()).toEqual([{
      pluginId: defined.pluginId,
      agentId: AGENT_A.id,
      packages: [{
        packageId: defined.packageId,
        name: 'Typed durable plugin',
        purpose: 'prove build and restart recovery',
        hasHostHalf: true,
        hasClientHalf: false,
      }],
      currentPackageId: defined.packageId,
    }])
    expect(restarted.ctx.get('typedAnswer')).toBeUndefined()
    expect(restarted.runner.inspectPackage(AGENT_A, defined.pluginId, defined.packageId).code.host)
      .toBe(hostSource)

    await expect(restarted.runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run'))
      .resolves.toMatchObject({ ok: true, status: 'running' })
    expect(restarted.ctx.get('typedAnswer')).toEqual({ value: 42 })
    const next = restarted.runner.define({
      sessionId: AGENT_A.id,
      plugin: { kind: 'new', idPrefix: 'typed' },
      name: 'Next identity',
      purpose: 'prove counters survive restart',
      code: { host: 'return () => {}' },
    })
    expect(next).toMatchObject({ pluginId: CordisDynamicPluginId('typed-2'), packageId: 'pkg-2' })
    await restarted.ctx.fiber.dispose()
  })
})
