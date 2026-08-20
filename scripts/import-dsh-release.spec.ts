import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importDshRelease } from './import-dsh-release.ts'

const roots: string[] = []

function fixture(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function gitInput(root: string, input: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input }).trim()
}

function refs(root: string): string {
  return git(root, 'show-ref')
}

function commitTree(root: string, tree: string, parent: string | undefined, message: string): string {
  const args = ['commit-tree', tree]
  if (parent !== undefined) args.push('-p', parent)
  return gitInput(root, message, ...args)
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

function initRepository(root: string): void {
  git(root, 'init', '--quiet')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'config', 'user.email', 'fixture@example.test')
}

function createUpstream(): { root: string; origin: string } {
  const root = fixture('dsh-import-upstream-')
  const origin = 'https://example.test/deepseek-harness.git'
  initRepository(root)
  git(root, 'remote', 'add', 'origin', origin)
  write(root, 'README.md', '# Voyaseek Harness\n')
  write(root, 'theme.css', ':root { --dsw-static-voyaseek-500: blue; }\n')
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'rc5')
  git(root, 'tag', 'dsh-v0.1.0-rc.5')
  write(root, 'feature.ts', "export const feature = '@voyaseek-ai/dsh-feature'\n")
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'rc8')
  git(root, 'tag', 'dsh-v0.1.0-rc.8')
  return { root, origin }
}

function createProduct(): string {
  const root = fixture('dsh-import-product-')
  initRepository(root)
  const source = new URL('./rebrand.ts', import.meta.url)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  cpSync(source, join(root, 'scripts/rebrand.ts'))
  git(root, 'add', '-A')
  git(root, 'commit', '--quiet', '-m', 'product')
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('importDshRelease', () => {
  it('creates exact raw snapshots and idempotent rebranded snapshot chains', () => {
    const upstream = createUpstream()
    const product = createProduct()

    importDshRelease({
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
      mode: 'apply',
    })

    expect(git(product, 'rev-parse', 'dsh-snapshot-v0.1.0-rc.8^{tree}'))
      .toBe(git(upstream.root, 'rev-parse', 'dsh-v0.1.0-rc.8^{tree}'))
    expect(git(product, 'show', 'dsh-rebranded-snapshot-v0.1.0-rc.8:README.md'))
      .toBe('# Voyaseek Harness')
    expect(git(product, 'show', 'dsh-rebranded-snapshot-v0.1.0-rc.8:theme.css'))
      .toContain('--dsw-static-voyaseek-500')
    expect(git(product, 'show', 'dsh-rebranded-snapshot-v0.1.0-rc.8:feature.ts'))
      .toContain('@voyaseek-ai/dsh-feature')
    expect(git(product, 'rev-parse', 'refs/heads/codex/dsh-upstream-snapshots'))
      .toBe(git(product, 'rev-parse', 'dsh-snapshot-v0.1.0-rc.8'))
    expect(git(product, 'rev-parse', 'refs/heads/codex/dsh-upstream-rebranded-snapshots'))
      .toBe(git(product, 'rev-parse', 'dsh-rebranded-snapshot-v0.1.0-rc.8'))
    expect(git(product, 'show', '-s', '--format=%P', 'dsh-snapshot-v0.1.0-rc.8'))
      .toBe(git(product, 'rev-parse', 'dsh-snapshot-v0.1.0-rc.5'))
    expect(git(product, 'show', '-s', '--format=%B', 'dsh-snapshot-v0.1.0-rc.8'))
      .toContain('Upstream-Tree: ')
    expect(git(product, 'show', '-s', '--format=%B', 'dsh-rebranded-snapshot-v0.1.0-rc.8'))
      .toContain('Rebrand-Script-Blob: ')

    expect(() => importDshRelease({
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
      mode: 'check',
    })).not.toThrow()
  }, 20_000)


  it('uses a recorded previous commit when upstream removed the historical tag', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const previousCommit = git(upstream.root, 'rev-parse', 'dsh-v0.1.0-rc.5^{commit}')
    git(upstream.root, 'tag', '--delete', 'dsh-v0.1.0-rc.5')

    expect(() => importDshRelease({
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      previousCommit,
      tag: 'dsh-v0.1.0-rc.8',
      mode: 'apply',
    })).not.toThrow()
    expect(git(product, 'show', '-s', '--format=%B', 'dsh-snapshot-v0.1.0-rc.5'))
      .toContain(`Upstream-Commit: ${previousCommit}`)
  })

  it('refuses existing raw and rebranded snapshots whose trees differ from current inputs', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    importDshRelease({ ...options, mode: 'apply' })

    const rawParent = git(product, 'rev-parse', 'dsh-snapshot-v0.1.0-rc.5')
    const rawMessage = git(product, 'show', '-s', '--format=%B', 'dsh-snapshot-v0.1.0-rc.8')
    const wrongTree = git(product, 'rev-parse', 'HEAD^{tree}')
    const wrongRaw = commitTree(product, wrongTree, rawParent, rawMessage)
    git(product, 'tag', '--force', 'dsh-snapshot-v0.1.0-rc.8', wrongRaw)
    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/points to tree .* expected/u)

    git(product, 'tag', '--force', 'dsh-snapshot-v0.1.0-rc.8', 'refs/heads/codex/dsh-upstream-snapshots')
    const rebrandedParent = git(product, 'rev-parse', 'dsh-rebranded-snapshot-v0.1.0-rc.5')
    const rebrandedMessage = git(product, 'show', '-s', '--format=%B', 'dsh-rebranded-snapshot-v0.1.0-rc.8')
    const wrongRebranded = commitTree(product, wrongTree, rebrandedParent, rebrandedMessage)
    git(product, 'tag', '--force', 'dsh-rebranded-snapshot-v0.1.0-rc.8', wrongRebranded)
    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/points to tree .* expected/u)
  }, 20_000)

  it('refuses an existing snapshot with the wrong release parent', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    importDshRelease({ ...options, mode: 'apply' })

    const tree = git(product, 'rev-parse', 'dsh-snapshot-v0.1.0-rc.8^{tree}')
    const message = git(product, 'show', '-s', '--format=%B', 'dsh-snapshot-v0.1.0-rc.8')
    const wrong = commitTree(product, tree, git(product, 'rev-parse', 'HEAD'), message)
    git(product, 'tag', '--force', 'dsh-snapshot-v0.1.0-rc.8', wrong)

    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/has parent\(s\).* expected/u)
  }, 20_000)

  it('keeps dry and failed check modes free of ref writes', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    const before = refs(product)

    importDshRelease({ ...options, mode: 'dry' })
    expect(refs(product)).toBe(before)
    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/missing immutable snapshot ref/u)
    expect(refs(product)).toBe(before)
  })

  it('rejects a snapshot branch that cannot advance from the previous release', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const branch = 'refs/heads/codex/dsh-upstream-snapshots'
    git(product, 'update-ref', branch, 'HEAD')
    const before = refs(product)

    expect(() => importDshRelease({
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
      mode: 'apply',
    })).toThrow(/expected previous snapshot <none>/u)
    expect(refs(product)).toBe(before)
  })


  it('creates a script-hash rebrand epoch without changing legacy snapshot refs', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    importDshRelease({ ...options, mode: 'apply' })
    const legacy = git(product, 'rev-parse', 'dsh-rebranded-snapshot-v0.1.0-rc.8')
    const blob = git(product, 'hash-object', '--no-filters', 'scripts/rebrand.ts')
    const epoch = `r${blob.slice(0, 12)}`

    importDshRelease({ ...options, currentRebrandEpoch: true, mode: 'apply' })

    expect(git(product, 'rev-parse', 'dsh-rebranded-snapshot-v0.1.0-rc.8')).toBe(legacy)
    expect(git(product, 'rev-parse', `dsh-rebranded-snapshot-v0.1.0-rc.8-${epoch}`))
      .toBe(git(product, 'rev-parse', `refs/heads/codex/dsh-upstream-rebranded-snapshots-${epoch}`))
    expect(git(product, 'show', '-s', '--format=%B', `dsh-rebranded-snapshot-v0.1.0-rc.8-${epoch}`))
      .toContain(`Rebrand-Epoch: ${epoch}`)
  }, 20_000)

  it('requires an explicit epoch choice when the current rebrand script differs', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    importDshRelease({ ...options, mode: 'apply' })
    write(product, 'scripts/rebrand.ts', `${readFileSync(join(product, 'scripts/rebrand.ts'), 'utf8')}\n// changed epoch\n`)

    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/choose --recorded-rebrand-epoch or --current-rebrand-epoch/u)
    expect(() => importDshRelease({ ...options, recordedRebrandEpoch: true, mode: 'check' }))
      .not.toThrow()
    expect(() => importDshRelease({ ...options, currentRebrandEpoch: true, mode: 'apply' }))
      .not.toThrow()
  }, 20_000)

  it('rejects incomplete snapshot metadata outside exact legacy exceptions', () => {
    const upstream = createUpstream()
    const product = createProduct()
    const options = {
      repositoryRoot: product,
      checkout: upstream.root,
      expectedOrigin: upstream.origin,
      previousTag: 'dsh-v0.1.0-rc.5',
      tag: 'dsh-v0.1.0-rc.8',
    } as const
    importDshRelease({ ...options, mode: 'apply' })

    const upstream5 = git(upstream.root, 'rev-parse', 'dsh-v0.1.0-rc.5^{commit}')
    const upstreamTree5 = git(upstream.root, 'rev-parse', 'dsh-v0.1.0-rc.5^{tree}')
    const incomplete = commitTree(product, upstreamTree5, undefined, `legacy\n\nUpstream-Commit: ${upstream5}\n`)
    git(product, 'update-ref', 'refs/tags/dsh-snapshot-v0.1.0-rc.5', incomplete)

    expect(() => importDshRelease({ ...options, mode: 'check' }))
      .toThrow(/lacks the expected Upstream-Tree trailer/u)
  }, 20_000)
})
