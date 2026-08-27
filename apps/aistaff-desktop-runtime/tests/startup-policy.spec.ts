import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyStartupPolicy } from '../scripts/verify-startup-policy.mjs'

const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'aistaff-startup-policy-test-'))
  fixtures.push(root)
  writeFixtureFile(join(root, 'desktop', 'dist', 'main.js'), 'export {}')
  writeFixtureFile(join(root, 'desktop', 'dist', 'preload.cjs'), 'module.exports = {}')
  writeFixtureFile(join(root, 'runtime', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'pty.node'), 'native')
  const policy = {
    schemaVersion: 1,
    required: {
      desktopDist: {
        root: 'desktop/dist',
        extensions: ['.js', '.cjs'],
      },
      maxTotalBytes: 1024,
    },
    deferred: {
      managedRuntimeRoot: 'runtime',
      activation: 'after-browser-window-create',
    },
    excluded: {
      nodePtyPrebuilds: {
        root: 'runtime/node_modules/node-pty/prebuilds',
        mode: 'all-except-target',
        target: 'darwin-x64',
      },
    },
  }
  const policyPath = join(root, 'startup-policy.json')
  writeFixtureFile(policyPath, `${JSON.stringify(policy)}\n`)
  return { root, policy, policyPath }
}

function writeFixtureFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writePolicy(path: string, policy: object) {
  writeFileSync(path, `${JSON.stringify(policy)}\n`)
}

describe('desktop startup policy verifier', () => {
  it('classifies Electron code as required and the complete managed runtime as deferred', () => {
    const { root, policyPath } = createFixture()

    expect(verifyStartupPolicy(policyPath, root)).toEqual({
      event: 'aistaff_desktop_startup_policy_verified',
      verification: 'full',
      policyPath: 'startup-policy.json',
      required: {
        totalBytes: 28,
        fileCount: 2,
        maxTotalBytes: 1024,
      },
      deferred: {
        managedRuntimeRoot: 'runtime',
        activation: 'after-browser-window-create',
      },
      excluded: {
        nodePtyPrebuildRoot: 'runtime/node_modules/node-pty/prebuilds',
        target: 'darwin-x64',
      },
    })
  })

  it('checks the required closure without requiring a generated runtime during compilation', () => {
    const { root, policyPath } = createFixture()
    rmSync(join(root, 'runtime'), { recursive: true })

    expect(verifyStartupPolicy(policyPath, root, { requiredOnly: true })).toMatchObject({
      verification: 'required-only',
      required: { fileCount: 2 },
    })
  })

  it('rejects required-byte budget growth', () => {
    const { root, policy, policyPath } = createFixture()
    policy.required.maxTotalBytes = 1
    writePolicy(policyPath, policy)

    expect(() => verifyStartupPolicy(policyPath, root)).toThrow('required-byte budget exceeded')
  })

  it('rejects obsolete startup-shell classification', () => {
    const { root, policy, policyPath } = createFixture()
    writePolicy(policyPath, {
      ...policy,
      required: {
        ...policy.required,
        startupShell: { html: 'desktop/assets/startup.html', resources: [] },
      },
    })

    expect(() => verifyStartupPolicy(policyPath, root)).toThrow(
      'startup policy required category keys must be exactly: desktopDist, maxTotalBytes',
    )
  })

  it('rejects the obsolete startup-shell activation point', () => {
    const { root, policy, policyPath } = createFixture()
    policy.deferred.activation = 'after-startup-shell-show'
    writePolicy(policyPath, policy)

    expect(() => verifyStartupPolicy(policyPath, root)).toThrow(
      'startup policy deferred.activation must be after-browser-window-create',
    )
  })

  it('rejects category overlap and a missing deferred runtime', () => {
    const { root, policy, policyPath } = createFixture()
    policy.required.desktopDist.root = 'runtime/dist'
    writeFixtureFile(join(root, 'runtime', 'dist', 'main.js'), 'export {}')
    writeFixtureFile(join(root, 'runtime', 'dist', 'preload.cjs'), 'module.exports = {}')
    writePolicy(policyPath, policy)
    expect(() => verifyStartupPolicy(policyPath, root)).toThrow('also inside the deferred runtime')

    policy.required.desktopDist.root = 'desktop/dist'
    policy.deferred.managedRuntimeRoot = 'missing-runtime'
    writePolicy(policyPath, policy)
    expect(() => verifyStartupPolicy(policyPath, root)).toThrow('deferred managed runtime root is missing')
  })

  it('rejects a stager target mismatch and non-target prebuild content', () => {
    const { root, policy, policyPath } = createFixture()
    policy.excluded.nodePtyPrebuilds.target = 'darwin-arm64'
    writePolicy(policyPath, policy)
    expect(() => verifyStartupPolicy(policyPath, root)).toThrow('must match the runtime stager target darwin-x64')

    policy.excluded.nodePtyPrebuilds.target = 'darwin-x64'
    writeFixtureFile(join(root, 'runtime', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'pty.node'), 'native')
    writePolicy(policyPath, policy)
    expect(() => verifyStartupPolicy(policyPath, root)).toThrow('excluded node-pty prebuild: win32-x64')
  })

  it('rejects extra schema keys instead of creating a fourth startup class', () => {
    const { root, policy, policyPath } = createFixture()
    writePolicy(policyPath, { ...policy, optional: {} })

    expect(() => verifyStartupPolicy(policyPath, root)).toThrow(
      'startup policy keys must be exactly: deferred, excluded, required, schemaVersion',
    )
  })
})
