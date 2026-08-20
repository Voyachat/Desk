import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_RUNTIME_BYTES,
  MAX_RUNTIME_FILE_COUNT,
  assertRuntimeBudget,
  createRuntimeDeployArgs,
  ensureTargetNodePtySpawnHelperExecutable,
  inspectRuntime,
  pruneNodePtyPrebuilds,
  rejectNonTargetNodePtyPrebuilds,
  removeDeployMetadata,
  verifyTargetNodePtyPrebuilds,
} from '../scripts/stage-runtime.mjs'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function createNodePtyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aistaff-runtime-test-'))
  fixtures.push(root)
  const nodePty = join(root, 'node_modules', 'node-pty')
  writeFixtureFile(join(nodePty, 'LICENSE'), 'MIT')
  writeFixtureFile(join(nodePty, 'prebuilds', 'darwin-x64', 'pty.node'), 'target-addon')
  writeFixtureFile(join(nodePty, 'prebuilds', 'darwin-x64', 'spawn-helper'), 'target-helper')
  writeFixtureFile(join(nodePty, 'prebuilds', 'darwin-arm64', 'pty.node'), 'arm-addon')
  writeFixtureFile(join(nodePty, 'prebuilds', 'win32-x64', 'pty.node'), 'windows-addon')
  return { root, nodePty }
}

function writeFixtureFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('desktop runtime staging policy', () => {
  it('deploys offline from the shared lockfile without running lifecycle scripts', () => {
    const args = createRuntimeDeployArgs('/tmp/aistaff-runtime')

    expect(args).toEqual([
      '--offline',
      '--frozen-lockfile',
      '--filter', '@voyaseek-ai/dsh-aistaff-desktop-runtime',
      'deploy', '--prod', '--ignore-scripts',
      '--config.node-linker=hoisted',
      '--config.link-workspace-packages=true',
      '--config.inject-workspace-packages=true',
      '/tmp/aistaff-runtime',
    ])
    expect(args).toContain('--frozen-lockfile')
    expect(args).not.toContain('--legacy')
    expect(args).not.toContain('--config.lockfile=false')
    expect(args).not.toContain('--config.frozen-lockfile=false')
    expect(args).not.toContain('--config.dangerously-allow-all-builds=true')
  })

  it('removes modern deploy metadata after materialization', () => {
    const root = mkdtempSync(join(tmpdir(), 'aistaff-runtime-metadata-test-'))
    fixtures.push(root)
    for (const path of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'node_modules/.modules.yaml',
      'node_modules/.pnpm-workspace-state-v1.json',
      'node_modules/.pnpm/lock.yaml',
    ]) writeFixtureFile(join(root, ...path.split('/')), 'development path')
    writeFixtureFile(join(root, 'node_modules', 'koffi', 'package.json'), '{}')

    removeDeployMetadata(root)

    expect(existsSync(join(root, 'package.json'))).toBe(false)
    expect(existsSync(join(root, 'pnpm-lock.yaml'))).toBe(false)
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(false)
    expect(existsSync(join(root, 'node_modules', '.modules.yaml'))).toBe(false)
    expect(existsSync(join(root, 'node_modules', '.pnpm-workspace-state-v1.json'))).toBe(false)
    expect(existsSync(join(root, 'node_modules', '.pnpm'))).toBe(false)
    expect(existsSync(join(root, 'node_modules', 'koffi', 'package.json'))).toBe(true)
  })

  it('restores the target node-pty spawn-helper executable mode', () => {
    const { root, nodePty } = createNodePtyFixture()
    const helper = join(nodePty, 'prebuilds', 'darwin-x64', 'spawn-helper')
    chmodSync(helper, 0o644)

    ensureTargetNodePtySpawnHelperExecutable(root)

    expect(statSync(helper).mode & 0o777).toBe(0o755)
    expect(() => verifyTargetNodePtyPrebuilds(root)).not.toThrow()
  })

  it('rejects every staged node-pty copy when one is missing its spawn-helper', () => {
    const { root } = createNodePtyFixture()
    const nestedNodePty = join(root, 'node_modules', 'consumer', 'node_modules', 'node-pty')
    writeFixtureFile(join(nestedNodePty, 'prebuilds', 'darwin-x64', 'pty.node'), 'nested-addon')

    ensureTargetNodePtySpawnHelperExecutable(root)

    expect(() => verifyTargetNodePtyPrebuilds(root)).toThrow('spawn-helper is missing')
  })
  it('retains the license and darwin-x64 binaries while removing other node-pty prebuilds', () => {
    const { root, nodePty } = createNodePtyFixture()

    expect(() => rejectNonTargetNodePtyPrebuilds(root)).toThrow('darwin-arm64')
    const summary = pruneNodePtyPrebuilds(root)

    expect(summary).toMatchObject({
      targetNodePtyPrebuild: 'darwin-x64',
      removedPrebuilds: ['darwin-arm64', 'win32-x64'],
      removedFiles: 2,
    })
    expect(summary.removedBytes).toBe(Buffer.byteLength('arm-addonwindows-addon'))
    expect(readFileSync(join(nodePty, 'LICENSE'), 'utf8')).toBe('MIT')
    expect(readFileSync(join(nodePty, 'prebuilds', 'darwin-x64', 'pty.node'), 'utf8')).toBe('target-addon')
    expect(readFileSync(join(nodePty, 'prebuilds', 'darwin-x64', 'spawn-helper'), 'utf8')).toBe('target-helper')
    expect(() => rejectNonTargetNodePtyPrebuilds(root)).not.toThrow()
  })

  it('measures regular files and rejects either runtime budget regression', () => {
    const { root } = createNodePtyFixture()

    expect(inspectRuntime(root)).toEqual({
      totalBytes: Buffer.byteLength('MITtarget-addontarget-helperarm-addonwindows-addon'),
      fileCount: 5,
    })
    expect(() => assertRuntimeBudget({
      totalBytes: MAX_RUNTIME_BYTES,
      fileCount: MAX_RUNTIME_FILE_COUNT,
    })).not.toThrow()
    expect(() => assertRuntimeBudget({
      totalBytes: MAX_RUNTIME_BYTES + 1,
      fileCount: 1,
    })).toThrow('byte budget exceeded')
    expect(() => assertRuntimeBudget({
      totalBytes: 1,
      fileCount: MAX_RUNTIME_FILE_COUNT + 1,
    })).toThrow('file-count budget exceeded')
  })
})
