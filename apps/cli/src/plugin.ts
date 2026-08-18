/**
 * `dsh plugin --profile <name> <args...>` — profile plugin management as a
 * guarded pnpm adapter. `audit` and `add` accept local immutable artifacts or
 * explicit development directories; add performs the same static review,
 * binds warning approval to the reviewed digest, disables lifecycle scripts,
 * then reconciles `dsh.profile.bundles` against the installed state.
 * @module @voyaseek-ai/dsh/plugin
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  resolveProfileDir,
  writeProfileManifest,
  type ProfileManifest,
} from '@voyaseek-ai/dsh-app-boot'
import { INSTALL_ANCHOR } from './profile-boot.ts'
import {
  auditPluginSource,
  localPluginSource,
  renderPluginAudit,
  type PluginAuditReport,
} from './plugin-audit.ts'

const NAME = 'dsh'

/**
 * Whether a resolved dependency exports a profile patch, i.e. is a bundle.
 * @param packageName - the dependency's package name.
 * @param profileDir - the profile directory (resolution anchor).
 * @returns true when the package manifest declares `dsh.bundle`.
 */
function exportsPatch(packageName: string, profileDir: string): boolean {
  let dir: string
  try {
    dir = resolveBundleDir(NAME, packageName, INSTALL_ANCHOR, profileDir)
  } catch {
    return false // pnpm reported success yet the package is unresolvable — treat as plain
  }
  const manifest = readProfileManifest(NAME, dir)
  return manifest.dsh?.bundle?.patch !== undefined
}

/**
 * Reconcile `dsh.profile.bundles` against the installed state: pnpm has
 * already written the real installed names (so a git/path/tarball/alias spec
 * on the command line reconciles by its true package name) and materialized
 * the packages. A dependency that resolves to a `dsh.bundle`-declaring
 * package joins the layer stack (appended in dependency order); a
 * dependency-listed name that no longer does — removed, or the installed
 * version dropped the declaration — leaves it. In-box bundles from the
 * profile template are not dependencies and are never touched. Warns once
 * per newly-added bundle-less dependency (a plain library is fine; the
 * warning is orientation).
 */
function reconcilePlugins(before: ProfileManifest, profileDir: string): void {
  const after = readProfileManifest(NAME, profileDir)
  const beforeDeps = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = after.dsh?.profile?.bundles ?? []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsPatch(packageName, profileDir)
    if (isBundle && !plugins.includes(packageName)) {
      plugins.push(packageName)
      changed = true
    } else if (!isBundle && !beforeDeps.has(packageName)) {
      process.stderr.write(
        `${NAME}: warning: ${packageName} declares no dsh.bundle — installed as a plain dependency, not a profile layer `
        + '(a later update that gains one activates it automatically)\n',
      )
    }
  }
  const dependencySet = new Set(dependencies)
  for (const packageName of [...plugins]) {
    // Only dependency-managed entries are subject to removal; template
    // bundles (dsh-base and friends) are not dependencies.
    const wasDependency = beforeDeps.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsPatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      plugins.splice(plugins.indexOf(packageName), 1)
      changed = true
    }
  }
  if (!changed) return
  after.dsh = { ...after.dsh, profile: { ...after.dsh?.profile, bundles: plugins } }
  writeProfileManifest(profileDir, after)
}

/**
 * Rewrite relative filesystem specs against the user's invoking directory.
 * pnpm runs with cwd = the profile directory, so a bare `.` or `../plugin`
 * (or their `file:`/`link:` forms) would silently resolve inside the profile
 * — `add .` from a plugin checkout would self-link the profile. Absolute
 * specs, registry names, and every other pnpm argument pass through
 * untouched.
 * @param argument - one pnpm argument, verbatim from argv.
 * @param cwd - the directory `dsh` was invoked from.
 * @returns the argument with a relative path spec anchored to `cwd`.
 */
function anchorPathSpec(argument: string, cwd: string): string {
  const match = /^(?<prefix>(?:file|link):)?(?<path>\.{1,2}(?:[/\\].*)?)$/.exec(argument)
  if (match?.groups?.path === undefined) return argument
  // A bare path stays bare and a prefixed spec keeps its prefix: pnpm's
  // link-vs-copy semantics differ between `file:` and a plain directory
  // path, and the anchor must not change which one the user asked for.
  const prefix = match.groups.prefix ?? ''
  return `${prefix}${resolve(cwd, match.groups.path)}`
}

const SAFE_ADD_FLAGS = new Set([
  '--save-dev', '-D', '--save-optional', '-O', '--save-exact', '-E',
  '--ignore-workspace-root-check', '--offline', '--prefer-offline',
])

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

/** Restrict non-install operations to fixed read and removal verbs. */
function prepareSafePluginOperation(args: readonly string[]): string[] {
  const command = args[0]
  if (command === 'list' || command === 'ls') {
    if (args.length !== 1) throw new Error('plugin list accepts no additional arguments')
    return ['list', '--depth', '0']
  }
  if (command === 'remove' || command === 'rm' || command === 'uninstall') {
    const names = args.slice(1)
    if (names.length === 0 || names.some(value => !PACKAGE_NAME.test(value))) {
      throw new Error('plugin remove accepts one or more installed package names and no flags')
    }
    return ['remove', ...names, '--ignore-scripts']
  }
  throw new Error('plugin command must be audit, add, remove, or list')
}

function approvalAndForwardedArgs(args: readonly string[]): {
  approval: string | null
  forwarded: string[]
} {
  let approval: string | null = null
  const forwarded: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index] as string
    if (argument === '--approve-audit') {
      const digest = args[index + 1]
      if (digest === undefined || digest.startsWith('-')) {
        throw new Error('--approve-audit requires the exact sha256 digest printed by the audit')
      }
      approval = digest
      index++
      continue
    }
    if (argument.startsWith('--approve-audit=')) {
      approval = argument.slice('--approve-audit='.length)
      if (approval === '') throw new Error('--approve-audit requires a digest')
      continue
    }
    forwarded.push(argument)
  }
  return { approval, forwarded }
}

/** Resolve, audit, and force script-free arguments for one local plugin add. */
export function prepareAuditedPluginAdd(args: readonly string[], cwd: string): {
  args: string[]
  report: PluginAuditReport
  approval: string | null
} {
  const parsed = approvalAndForwardedArgs(args)
  if (parsed.forwarded.some(argument => argument === '--dangerously-allow-all-builds'
    || argument === '--ignore-scripts=false')) {
    throw new Error('plugin installation cannot enable dependency lifecycle scripts')
  }
  const packageArguments = parsed.forwarded.slice(1).filter(argument => !argument.startsWith('-'))
  const unsupportedFlags = parsed.forwarded.slice(1)
    .filter(argument => argument.startsWith('-') && argument !== '--ignore-scripts' && !SAFE_ADD_FLAGS.has(argument))
  if (packageArguments.length !== 1 || unsupportedFlags.length > 0) {
    throw new Error(
      'audited plugin add accepts exactly one local package plus save/offline flags; audit and install additional plugins separately',
    )
  }
  const source = localPluginSource(packageArguments[0] as string, cwd)
  const report = auditPluginSource(source)
  const anchored = parsed.forwarded.map(argument =>
    argument === packageArguments[0] ? source : argument)
  if (!anchored.includes('--ignore-scripts')) anchored.push('--ignore-scripts')
  return { args: anchored, report, approval: parsed.approval }
}

function explicitAudit(args: readonly string[], cwd: string): number | null {
  if (args[0] !== 'audit') return null
  if (args.length !== 2) {
    process.stderr.write(`${NAME}: plugin audit needs exactly one local directory or tarball\n`)
    return 2
  }
  try {
    const source = localPluginSource(args[1] as string, cwd)
    const report = auditPluginSource(source)
    process.stderr.write(renderPluginAudit(report))
    return report.status === 'blocked' ? 2 : 0
  } catch (error) {
    process.stderr.write(`${NAME}: plugin audit failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
}

/**
 * Run one `dsh plugin` invocation: audit add inputs, init if needed, forward safe operations, reconcile.
 * @param profile - the profile name.
 * @param args - pnpm arguments with relative path specs anchored to the invoking directory.
 * @returns the pnpm exit code.
 */
export function runPlugin(profile: string, args: readonly string[]): number {
  const invokingCwd = process.cwd()
  const auditExit = explicitAudit(args, invokingCwd)
  if (auditExit !== null) return auditExit
  let forwardedArgs = [...args]
  if (args[0] === 'add') {
    let audited: ReturnType<typeof prepareAuditedPluginAdd>
    try {
      audited = prepareAuditedPluginAdd(args, invokingCwd)
    } catch (error) {
      process.stderr.write(`${NAME}: plugin install blocked: ${error instanceof Error ? error.message : String(error)}\n`)
      return 2
    }
    process.stderr.write(renderPluginAudit(audited.report))
    if (audited.report.status === 'blocked') return 2
    if (audited.report.status === 'review' && audited.approval !== audited.report.digest) {
      process.stderr.write(
        `${NAME}: review the warnings, then re-run with --approve-audit ${audited.report.digest}\n`,
      )
      return 2
    }
    forwardedArgs = audited.args
  } else {
    try {
      forwardedArgs = prepareSafePluginOperation(args)
    } catch (error) {
      process.stderr.write(`${NAME}: plugin command blocked: ${error instanceof Error ? error.message : String(error)}\n`)
      return 2
    }
  }
  const dir = resolveProfileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, PROFILE_TEMPLATES[profile] ?? DEFAULT_PROFILE_BUNDLES)
    process.stderr.write(`${NAME}: initialized profile ${profile} at ${dir}\n`)
  }
  const before = readProfileManifest(NAME, dir)
  // Windows resolves pnpm through its .cmd shim, which spawn() refuses
  // without a shell since the CVE-2024-27980 hardening.
  const result = spawnSync('pnpm', forwardedArgs.map(argument => anchorPathSpec(argument, invokingCwd)), {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      process.stderr.write(`${NAME}: pnpm not found on PATH — install pnpm to manage profile plugins\n`)
      return 127
    }
    throw result.error
  }
  const exitCode = result.status ?? 1
  if (exitCode === 0) {
    reconcilePlugins(before, dir)
  } else {
    // pnpm's own diagnostics name pnpm-workspace.yaml without saying WHICH
    // one; the profile owns it, and the commonest failure here is pnpm ≥10
    // blocking a git dependency's prepare (build) script until allowlisted.
    process.stderr.write(`${NAME}: pnpm failed in profile directory ${dir}\n`)
  }
  return exitCode
}
