/**
 * Import one immutable DSH release as raw and mechanically rebranded snapshot refs.
 *
 * The importer verifies the official checkout, release ancestry, exact raw Git tree,
 * rebrand idempotence, and immutable local refs. It never merges a product branch,
 * updates the adoption ledger, pushes, packages, or publishes.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_ORIGIN = 'https://github.com/deepseek-ai/deepseek-harness.git'
const RAW_BRANCH = 'refs/heads/codex/dsh-upstream-snapshots'
const REBRANDED_BRANCH = 'refs/heads/codex/dsh-upstream-rebranded-snapshots'
const repositoryRoot = resolve(import.meta.dirname, '..')

type SnapshotTrailerName = 'Upstream-Tree' | 'Upstream-Tag'

const LEGACY_METADATA_EXCEPTIONS: ReadonlyMap<string, {
  readonly commit: string
  readonly missing: ReadonlySet<SnapshotTrailerName>
}> = new Map([
  ['refs/tags/dsh-snapshot-v0.1.0-rc.5', {
    commit: '6532733646d7213d40df65d107330356eabdec7e',
    missing: new Set(['Upstream-Tree', 'Upstream-Tag']),
  }],
  ['refs/tags/dsh-snapshot-v0.1.0-rc.8', {
    commit: '6a83206568e981d8b55c0aa6532b0c253e85e89c',
    missing: new Set(['Upstream-Tree']),
  }],
  ['refs/tags/dsh-rebranded-snapshot-v0.1.0-rc.5', {
    commit: '0eda8f167ed72d28a756dde69071d880262835e2',
    missing: new Set(['Upstream-Tag']),
  }],
] as const)

type ImportMode = 'dry' | 'check' | 'apply'
type SnapshotKind = 'raw' | 'rebranded'

/** Immutable facts resolved from one official release tag. */
export interface ReleaseFacts {
  /** Official tag supplied to the importer. */
  readonly tag: string
  /** Version suffix used in local snapshot tag names. */
  readonly version: string
  /** Official commit resolved from the tag. */
  readonly commit: string
  /** Official root tree for the commit. */
  readonly tree: string
  /** Official commit timestamp used for deterministic snapshot commits. */
  readonly committedAt: string
}

/** Inputs for one release import or verification. */
export interface ImportDshReleaseOptions {
  /** AiDesktop Git worktree that owns the snapshot refs and rebrand script. */
  readonly repositoryRoot: string
  /** Clean, read-only checkout of the official DSH repository. */
  readonly checkout: string
  /** Target release tag. */
  readonly tag: string
  /** Previously adopted release tag, which must be an ancestor of target. */
  readonly previousTag?: string
  /** Exact previous release commit used only when upstream removed that historical tag ref. */
  readonly previousCommit?: string
  /** Explicitly replay the script embedded in the existing unnamespaced rebrand epoch. */
  readonly recordedRebrandEpoch?: boolean
  /** Explicitly use the current script in a script-hash namespace. */
  readonly currentRebrandEpoch?: boolean
  /** Dry plan, immutable ref verification, or local ref creation. */
  readonly mode: ImportMode
  /** Expected checkout origin; tests may provide a local fixture origin. */
  readonly expectedOrigin?: string
}

interface SnapshotRefs {
  readonly branch: string
  readonly tag: string
}

interface SnapshotMetadata {
  readonly kind: SnapshotKind
  readonly release: ReleaseFacts
  readonly tree: string
  readonly rebrandScriptBlob?: string
  readonly rebrandEpoch?: string
}

interface PreparedRelease {
  readonly rawTree: string
  readonly rebrandedTree: string
  readonly rebrandScriptBlob: string
}

interface ExistingSnapshot {
  readonly commit: string
}

interface CommandOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
}

/** Execute one Git command and return trimmed stdout. */
function git(cwd: string, args: readonly string[], options: CommandOptions = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    input: options.input,
  }).trim()
}

/** Resolve a ref without emitting Git's normal missing-ref diagnostic. */
function tryResolve(repository: string, ref: string): string | undefined {
  try {
    return git(repository, ['rev-parse', '--verify', '--quiet', ref])
  } catch {
    return undefined
  }
}

/** Fail when an importer obligation is not satisfied. */
function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Convert `dsh-v0.1.0-rc.8` to the stable local snapshot suffix. */
function releaseVersion(tag: string): string {
  invariant(tag.startsWith('dsh-v') && tag.length > 'dsh-v'.length, `unsupported DSH release tag: ${tag}`)
  return tag.slice('dsh-v'.length)
}

/** Resolve immutable release facts from the approved checkout. */
export function resolveReleaseFacts(checkout: string, tag: string, expectedCommit?: string): ReleaseFacts {
  const taggedCommit = tryResolve(checkout, `${tag}^{commit}`)
  invariant(taggedCommit !== undefined || expectedCommit !== undefined, `missing DSH release tag ${tag}; supply its recorded exact commit`)
  const commit = taggedCommit ?? git(checkout, ['rev-parse', `${expectedCommit}^{commit}`])
  invariant(expectedCommit === undefined || commit === expectedCommit, `${tag} resolves to ${commit}, expected recorded commit ${expectedCommit}`)
  return {
    tag,
    version: releaseVersion(tag),
    commit,
    tree: git(checkout, ['rev-parse', `${commit}^{tree}`]),
    committedAt: git(checkout, ['show', '-s', '--format=%cI', commit]),
  }
}

/** Return the local raw or rebranded refs for one release. */
function snapshotRefs(kind: SnapshotKind, release: ReleaseFacts, rebrandEpoch?: string): SnapshotRefs {
  if (kind === 'raw') {
    return { branch: RAW_BRANCH, tag: `refs/tags/dsh-snapshot-v${release.version}` }
  }
  const suffix = rebrandEpoch === undefined ? '' : `-${rebrandEpoch}`
  return {
    branch: rebrandEpoch === undefined ? REBRANDED_BRANCH : `${REBRANDED_BRANCH}-${rebrandEpoch}`,
    tag: `refs/tags/dsh-rebranded-snapshot-v${release.version}${suffix}`,
  }
}

/** Verify checkout identity, cleanliness, and target ancestry. */
function verifySource(options: ImportDshReleaseOptions, previous: ReleaseFacts | undefined, target: ReleaseFacts): void {
  const expectedOrigin = options.expectedOrigin ?? DEFAULT_ORIGIN
  const origin = git(options.checkout, ['remote', 'get-url', 'origin'])
  invariant(origin === expectedOrigin, `unexpected DSH origin: ${origin}; expected ${expectedOrigin}`)
  invariant(git(options.checkout, ['status', '--porcelain']) === '', `DSH checkout is not clean: ${options.checkout}`)
  if (previous === undefined) return
  try {
    git(options.checkout, ['merge-base', '--is-ancestor', previous.commit, target.commit])
  } catch {
    throw new Error(`${previous.tag} (${previous.commit}) is not an ancestor of ${target.tag} (${target.commit})`)
  }
}

/** Build a Git tree from an arbitrary extracted worktree without using the product index. */
function writeTree(repository: string, workTree: string, indexPath: string): string {
  const env = { GIT_INDEX_FILE: indexPath }
  git(repository, ['read-tree', '--empty'], { env })
  git(repository, [`--work-tree=${workTree}`, 'add', '-f', '-A', '--', '.'], { env })
  return git(repository, ['write-tree'], { env })
}

/** Read one exact blob without text normalization. */
function readBlob(repository: string, blob: string): Buffer {
  return execFileSync('git', ['cat-file', 'blob', blob], { cwd: repository })
}

/** Run the script embedded in a rebranded snapshot candidate. */
function executeRebrand(workTree: string, mode: 'apply' | 'check'): void {
  const loader = fileURLToPath(import.meta.resolve('tsx/esm'))
  execFileSync(process.execPath, ['--import', loader, join(workTree, 'scripts/rebrand.ts'), `--${mode}`], {
    cwd: workTree,
    encoding: 'utf8',
  })
}

/** Extract an official commit and prepare exact raw and idempotent rebranded trees. */
function prepareRelease(
  options: ImportDshReleaseOptions,
  release: ReleaseFacts,
  temporaryRoot: string,
  rebrandScriptBlob: string,
  useCurrentScript: boolean,
): PreparedRelease {
  const releaseRoot = join(temporaryRoot, release.version)
  const rawRoot = join(releaseRoot, 'raw')
  const rebrandedRoot = join(releaseRoot, 'rebranded')
  const archivePath = join(releaseRoot, 'release.tar')
  mkdirSync(rawRoot, { recursive: true })
  mkdirSync(rebrandedRoot, { recursive: true })
  git(options.checkout, ['archive', '--format=tar', `--output=${archivePath}`, release.commit])
  execFileSync('tar', ['-xf', archivePath, '-C', rawRoot])
  execFileSync('tar', ['-xf', archivePath, '-C', rebrandedRoot])

  const rawTree = writeTree(options.repositoryRoot, rawRoot, join(releaseRoot, 'raw.index'))
  invariant(rawTree === release.tree, `${release.tag} archive tree ${rawTree} does not equal official tree ${release.tree}`)

  const embeddedScript = join(rebrandedRoot, 'scripts/rebrand.ts')
  mkdirSync(join(rebrandedRoot, 'scripts'), { recursive: true })
  if (useCurrentScript) copyFileSync(resolve(options.repositoryRoot, 'scripts/rebrand.ts'), embeddedScript)
  else writeFileSync(embeddedScript, readBlob(options.repositoryRoot, rebrandScriptBlob))
  git(rebrandedRoot, ['init', '--quiet'])
  git(rebrandedRoot, ['add', '-f', '-A'])
  executeRebrand(rebrandedRoot, 'apply')
  git(rebrandedRoot, ['add', '-f', '-A'])
  const rebrandedTree = writeTree(options.repositoryRoot, rebrandedRoot, join(releaseRoot, 'rebranded.index'))
  if (useCurrentScript) {
    executeRebrand(rebrandedRoot, 'check')
  } else {
    executeRebrand(rebrandedRoot, 'apply')
    const replayedTree = writeTree(options.repositoryRoot, rebrandedRoot, join(releaseRoot, 'replayed.index'))
    invariant(replayedTree === rebrandedTree, `${release.tag} historical rebrand script is not idempotent`)
  }
  rmSync(join(rebrandedRoot, '.git'), { recursive: true })

  return { rawTree, rebrandedTree, rebrandScriptBlob }
}

/** Resolve the current rebrand script blob, storing it only for apply mode. */
function currentRebrandBlob(options: ImportDshReleaseOptions): string {
  const args = ['hash-object']
  if (options.mode === 'apply') args.push('-w')
  args.push('--no-filters', '--', resolve(options.repositoryRoot, 'scripts/rebrand.ts'))
  return git(options.repositoryRoot, args)
}

/** Read the script blob recorded by an existing rebranded snapshot. */
function recordedRebrandBlob(repository: string, ref: string): string | undefined {
  const commit = tryResolve(repository, ref)
  if (commit === undefined) return undefined
  return trailer(git(repository, ['show', '-s', '--format=%B', commit]), 'Rebrand-Script-Blob')
}

/** Render the immutable metadata trailers for one snapshot commit. */
function snapshotMessage(metadata: SnapshotMetadata): string {
  const title = metadata.kind === 'raw'
    ? `Import DSH ${metadata.release.version} release tree`
    : `Import rebranded DSH ${metadata.release.version} release tree`
  const trailers = [
    `Upstream-Commit: ${metadata.release.commit}`,
    `Upstream-Tree: ${metadata.release.tree}`,
    `Upstream-Tag: ${metadata.release.tag}`,
  ]
  if (metadata.rebrandScriptBlob !== undefined) trailers.push(`Rebrand-Script-Blob: ${metadata.rebrandScriptBlob}`)
  if (metadata.rebrandEpoch !== undefined) trailers.push(`Rebrand-Epoch: ${metadata.rebrandEpoch}`)
  return `${title}\n\n${trailers.join('\n')}\n`
}

/** Return one exact metadata trailer value when present. */
function trailer(message: string, name: string): string | undefined {
  const prefix = `${name}: `
  return message.split('\n').find(line => line.startsWith(prefix))?.slice(prefix.length)
}

/** Verify that an existing immutable snapshot ref represents the requested release. */
function verifyExistingSnapshot(
  repository: string,
  ref: string,
  metadata: SnapshotMetadata,
  expectedParent: string | undefined,
): ExistingSnapshot | undefined {
  const commit = tryResolve(repository, ref)
  if (commit === undefined) return undefined
  const actualTree = git(repository, ['rev-parse', `${commit}^{tree}`])
  invariant(actualTree === metadata.tree, `${ref} points to tree ${actualTree}, expected ${metadata.tree}`)

  const actualParents = git(repository, ['show', '-s', '--format=%P', commit])
  const expectedParents = expectedParent ?? ''
  invariant(actualParents === expectedParents, `${ref} has parent(s) ${actualParents || '<none>'}; expected ${expectedParents || '<none>'}`)

  const message = git(repository, ['show', '-s', '--format=%B', commit])
  invariant(trailer(message, 'Upstream-Commit') === metadata.release.commit, `${ref} lacks the expected Upstream-Commit trailer`)
  const permitsMissing = (name: SnapshotTrailerName): boolean => {
    const exception = LEGACY_METADATA_EXCEPTIONS.get(ref)
    return exception?.commit === commit && exception.missing.has(name)
  }
  const upstreamTree = trailer(message, 'Upstream-Tree')
  if (upstreamTree === undefined) invariant(permitsMissing('Upstream-Tree'), `${ref} lacks the expected Upstream-Tree trailer`)
  else invariant(upstreamTree === metadata.release.tree, `${ref} has Upstream-Tree ${upstreamTree}; expected ${metadata.release.tree}`)
  const upstreamTag = trailer(message, 'Upstream-Tag')
  if (upstreamTag === undefined) invariant(permitsMissing('Upstream-Tag'), `${ref} lacks the expected Upstream-Tag trailer`)
  else invariant(upstreamTag === metadata.release.tag, `${ref} has Upstream-Tag ${upstreamTag}; expected ${metadata.release.tag}`)

  if (metadata.kind === 'rebranded') {
    const scriptBlob = trailer(message, 'Rebrand-Script-Blob')
    invariant(scriptBlob !== undefined && /^[0-9a-f]{40}$/u.test(scriptBlob), `${ref} lacks a Rebrand-Script-Blob trailer`)
    invariant(scriptBlob === metadata.rebrandScriptBlob, `${ref} records rebrand script ${scriptBlob}; expected ${metadata.rebrandScriptBlob}`)
    invariant(tryResolve(repository, `${scriptBlob}^{blob}`) !== undefined, `${ref} names missing rebrand script blob ${scriptBlob}`)
    if (metadata.rebrandEpoch !== undefined) {
      invariant(trailer(message, 'Rebrand-Epoch') === metadata.rebrandEpoch, `${ref} lacks the expected Rebrand-Epoch trailer`)
    }
  }
  return { commit }
}

/** Create one deterministic snapshot commit and immutable local refs. */
function createSnapshot(
  repository: string,
  refs: SnapshotRefs,
  metadata: SnapshotMetadata,
  parent: string | undefined,
): string {
  const branchBefore = tryResolve(repository, refs.branch)
  if (branchBefore !== undefined && branchBefore !== parent) {
    throw new Error(`${refs.branch} points to ${branchBefore}; expected previous snapshot ${parent ?? '<none>'}`)
  }

  const args = ['commit-tree', metadata.tree]
  if (parent !== undefined) args.push('-p', parent)
  const identity = {
    GIT_AUTHOR_NAME: 'Voyaseek Upstream Import',
    GIT_AUTHOR_EMAIL: 'upstream-import@voyaseek.local',
    GIT_COMMITTER_NAME: 'Voyaseek Upstream Import',
    GIT_COMMITTER_EMAIL: 'upstream-import@voyaseek.local',
    GIT_AUTHOR_DATE: metadata.release.committedAt,
    GIT_COMMITTER_DATE: metadata.release.committedAt,
  }
  const commit = git(repository, args, { env: identity, input: snapshotMessage(metadata) })
  git(repository, ['update-ref', refs.tag, commit, ''])
  git(repository, ['update-ref', refs.branch, commit, branchBefore ?? ''])
  return commit
}

/** Verify or create one raw or rebranded snapshot. */
function ensureSnapshot(
  options: ImportDshReleaseOptions,
  metadata: SnapshotMetadata,
  parent: string | undefined,
): string | undefined {
  const refs = snapshotRefs(metadata.kind, metadata.release, metadata.rebrandEpoch)
  const existing = verifyExistingSnapshot(options.repositoryRoot, refs.tag, metadata, parent)
  if (existing !== undefined) {
    console.log(`import-dsh-release: verified ${refs.tag} -> ${existing.commit}`)
    return existing.commit
  }
  if (options.mode === 'check') throw new Error(`missing immutable snapshot ref ${refs.tag}`)
  if (options.mode === 'dry') {
    console.log(`import-dsh-release: would create ${refs.tag} with tree ${metadata.tree}`)
    return undefined
  }
  const commit = createSnapshot(options.repositoryRoot, refs, metadata, parent)
  console.log(`import-dsh-release: created ${refs.tag} -> ${commit}`)
  return commit
}

/** Keep the snapshot branch as the monotonic pointer to the newest imported tag. */
function ensureSnapshotBranch(
  repository: string,
  branch: string,
  expected: string,
  previous: string | undefined,
  mode: ImportMode,
): void {
  const actual = tryResolve(repository, branch)
  if (actual === expected) return
  if (actual !== undefined && actual !== previous) {
    throw new Error(`${branch} points to ${actual}; expected ${expected} or previous snapshot ${previous ?? '<none>'}`)
  }
  if (mode === 'check') throw new Error(`${branch} does not point to newest snapshot ${expected}`)
  if (mode === 'dry') {
    console.log(`import-dsh-release: would update ${branch} -> ${expected}`)
    return
  }
  git(repository, ['update-ref', branch, expected, actual ?? ''])
}

/**
 * Verify or create raw and rebranded snapshots for a DSH release pair.
 *
 * @param options - approved checkout, release tags, repository, and write mode.
 */
export function importDshRelease(options: ImportDshReleaseOptions): void {
  const checkout = realpathSync(options.checkout)
  const root = realpathSync(options.repositoryRoot)
  const normalized = { ...options, checkout, repositoryRoot: root }
  invariant(options.previousTag !== undefined || options.previousCommit === undefined, '--previous-commit requires --previous-tag')
  const previous = options.previousTag === undefined
    ? undefined
    : resolveReleaseFacts(checkout, options.previousTag, options.previousCommit)
  const target = resolveReleaseFacts(checkout, options.tag)
  verifySource(normalized, previous, target)

  invariant(!(options.recordedRebrandEpoch === true && options.currentRebrandEpoch === true), 'choose only one rebrand epoch')
  const releases = previous === undefined ? [target] : [previous, target]
  const currentBlob = currentRebrandBlob(normalized)
  const rebrandEpoch = options.currentRebrandEpoch === true ? `r${currentBlob.slice(0, 12)}` : undefined
  const recordedBlobs = releases
    .map(release => recordedRebrandBlob(root, snapshotRefs('rebranded', release, rebrandEpoch).tag))
    .filter((blob): blob is string => blob !== undefined)
  const uniqueRecordedBlobs = [...new Set(recordedBlobs)]
  invariant(uniqueRecordedBlobs.length <= 1, `rebranded snapshot chain mixes script blobs: ${uniqueRecordedBlobs.join(', ')}`)
  const recordedBlob = uniqueRecordedBlobs[0]
  if (options.recordedRebrandEpoch === true) {
    invariant(recordedBlob !== undefined, '--recorded-rebrand-epoch requires an existing unnamespaced rebranded snapshot chain')
  } else if (options.currentRebrandEpoch !== true && recordedBlob !== undefined && recordedBlob !== currentBlob) {
    throw new Error(`rebrand script changed from ${recordedBlob} to ${currentBlob}; choose --recorded-rebrand-epoch or --current-rebrand-epoch`)
  }
  const rebrandScriptBlob = options.currentRebrandEpoch === true ? currentBlob : recordedBlob ?? currentBlob
  const useCurrentScript = rebrandScriptBlob === currentBlob

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'voyaseek-dsh-import-'))
  try {
    let previousRaw: string | undefined
    let previousRebranded: string | undefined
    for (const release of releases) {
      const prepared = prepareRelease(normalized, release, temporaryRoot, rebrandScriptBlob, useCurrentScript)
      const raw = ensureSnapshot(normalized, { kind: 'raw', release, tree: prepared.rawTree }, previousRaw)
      const rebranded = ensureSnapshot(normalized, {
        kind: 'rebranded',
        release,
        tree: prepared.rebrandedTree,
        rebrandScriptBlob: prepared.rebrandScriptBlob,
        ...(rebrandEpoch === undefined ? {} : { rebrandEpoch }),
      }, previousRebranded)
      previousRaw = raw
      previousRebranded = rebranded
    }
    const targetRawRefs = snapshotRefs('raw', target)
    const targetRebrandedRefs = snapshotRefs('rebranded', target, rebrandEpoch)
    const targetRaw = tryResolve(root, targetRawRefs.tag)
    const targetRebranded = tryResolve(root, targetRebrandedRefs.tag)
    if (targetRaw !== undefined) ensureSnapshotBranch(root, targetRawRefs.branch, targetRaw, previous === undefined ? undefined : tryResolve(root, snapshotRefs('raw', previous).tag), options.mode)
    if (targetRebranded !== undefined) ensureSnapshotBranch(root, targetRebrandedRefs.branch, targetRebranded, previous === undefined ? undefined : tryResolve(root, snapshotRefs('rebranded', previous, rebrandEpoch).tag), options.mode)
  } finally {
    rmSync(temporaryRoot, { recursive: true })
  }
}

interface CliArgs {
  readonly checkout: string
  readonly tag: string
  readonly previousTag?: string
  readonly previousCommit?: string
  readonly recordedRebrandEpoch: boolean
  readonly currentRebrandEpoch: boolean
  readonly mode: ImportMode
}

/** Parse the intentionally small release-import CLI. */
function parseArgs(argv: readonly string[]): CliArgs {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const checkout = value('--checkout')
  const tag = value('--tag')
  invariant(checkout !== undefined, '--checkout is required')
  invariant(tag !== undefined, '--tag is required')
  const modes = (['--check', '--apply'] as const).filter(flag => argv.includes(flag))
  invariant(modes.length <= 1, 'choose at most one of --check and --apply')
  const previousTag = value('--previous-tag')
  const previousCommit = value('--previous-commit')
  return {
    checkout,
    tag,
    ...(previousTag === undefined ? {} : { previousTag }),
    ...(previousCommit === undefined ? {} : { previousCommit }),
    recordedRebrandEpoch: argv.includes('--recorded-rebrand-epoch'),
    currentRebrandEpoch: argv.includes('--current-rebrand-epoch'),
    mode: modes[0] === '--check' ? 'check' : modes[0] === '--apply' ? 'apply' : 'dry',
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  importDshRelease({ repositoryRoot, ...args })
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main()
}
