import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_RUNTIME_BYTES,
  MAX_RUNTIME_FILE_COUNT,
  assertRuntimeBudget,
  inspectRuntime,
  pruneNodePtyPrebuilds,
  rejectNonTargetNodePtyPrebuilds,
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
