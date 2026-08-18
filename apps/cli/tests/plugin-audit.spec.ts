import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create as createTar } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  auditPluginSource,
  localPluginSource,
  renderPluginAudit,
} from '../src/plugin-audit.ts'
import { prepareAuditedPluginAdd, runPlugin } from '../src/plugin.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function pluginFixture(overrides: Record<string, unknown> = {}, runtime = 'export const name = "fixture"\n'): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-audit-'))
  roots.push(root)
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'lib/index.js'), runtime)
  writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'review-fixture',
    version: '1.0.0',
    license: 'MIT',
    type: 'module',
    main: 'lib/index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...overrides,
  }))
  return root
}

describe('plugin pre-install audit', () => {
  it('passes an immutable tarball with a built runtime and valid bundle patch', () => {
    const root = pluginFixture()
    const artifact = join(root, 'plugin.tgz')
    createTar({ cwd: root, file: artifact, gzip: true, sync: true }, [
      'package.json', 'cordis.patch.yml', 'lib/index.js',
    ])

    const report = auditPluginSource(artifact)

    expect(report).toMatchObject({
      sourceKind: 'tarball',
      packageName: 'review-fixture',
      packageVersion: '1.0.0',
      license: 'MIT',
      status: 'pass',
      findings: [],
    })
    expect(report.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  it('requires explicit review for mutable directories and declared runtime capabilities', () => {
    const root = pluginFixture({}, [
      'export async function apply() {',
      '  const key = process.env.DEMO_KEY',
      '  await fetch("https://example.test", { headers: { authorization: key } })',
      '}',
      '',
    ].join('\n'))

    const report = auditPluginSource(root)

    expect(report.status).toBe('review')
    expect(report.findings.map(item => item.code)).toEqual(expect.arrayContaining([
      'mutable_directory', 'environment', 'network',
    ]))
    expect(renderPluginAudit(report)).toContain(`artifact: directory ${report.digest}`)
  })

  it('blocks packages without license, bundle metadata, or their built main', () => {
    const root = pluginFixture({ license: undefined, main: 'lib/missing.js', dsh: undefined })

    const report = auditPluginSource(root)

    expect(report.status).toBe('blocked')
    expect(report.findings.map(item => item.code)).toEqual(expect.arrayContaining([
      'package_license', 'bundle_manifest', 'runtime_entry_missing',
    ]))
  })

  it('blocks an invalid SPDX license expression', () => {
    const root = pluginFixture({ license: 'free for good people' })

    const report = auditPluginSource(root)

    expect(report.status).toBe('blocked')
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'package_license' }))
  })

  it('rejects remote and link specifications before package-manager execution', () => {
    expect(() => localPluginSource('github:owner/plugin#main', '/workspace'))
      .toThrow('remote plugin specs are disabled')
    expect(() => localPluginSource('link:../plugin', '/workspace'))
      .toThrow('link: plugin specs are mutable')
    expect(localPluginSource('file:../plugin.tgz', '/workspace/app'))
      .toBe('/workspace/plugin.tgz')
  })

  it('forces ignored scripts and binds warning approval to the reviewed digest', () => {
    const root = pluginFixture()
    const prepared = prepareAuditedPluginAdd(['add', root, '--save-dev'], '/workspace')

    expect(prepared.report.status).toBe('review')
    expect(prepared.approval).toBeNull()
    expect(prepared.args).toEqual(['add', root, '--save-dev', '--ignore-scripts'])

    const approved = prepareAuditedPluginAdd([
      'add', root, '--approve-audit', prepared.report.digest,
    ], '/workspace')
    expect(approved.approval).toBe(prepared.report.digest)
    expect(approved.report.digest).toBe(prepared.report.digest)
  })

  it('blocks remote add before profile initialization or pnpm execution', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runPlugin('must-not-exist', ['add', 'github:owner/plugin#main'])).toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('remote plugin specs are disabled'))
  })

  it('blocks pnpm execution verbs before profile initialization', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(runPlugin('must-not-exist', ['exec', 'node', '-e', 'process.exit(0)'])).toBe(2)
    expect(runPlugin('must-not-exist', ['run', 'postinstall'])).toBe(2)
    expect(runPlugin('must-not-exist', ['root'])).toBe(2)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('command must be audit, add, remove, or list'))
  })

  it('blocks non-canonical package entry paths', () => {
    const root = pluginFixture({ main: '../outside.js', dsh: { bundle: { patch: '../outside.yml' } } })

    const report = auditPluginSource(root)

    expect(report.status).toBe('blocked')
    expect(report.findings.map(item => item.code)).toEqual(expect.arrayContaining([
      'runtime_entry_path', 'bundle_patch_path',
    ]))
  })
})
