import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { extname, resolve as resolvePath } from 'node:path'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const oxlintCli = fileURLToPath(new URL('../node_modules/oxlint/bin/oxlint', import.meta.url))
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024
const FIX_FLAGS = new Set(['--fix', '--fix-dangerously', '--fix-suggestions'])
const CHANGED_FLAG = '--changed'
const LINTED_EXTENSIONS = new Set(['.cts', '.mts', '.ts', '.tsx'])

function isFixInvocation(args: readonly string[]): boolean {
  return args.some(arg => FIX_FLAGS.has(arg))
}

function gitLines(cwd: string, args: readonly string[]): string[] {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`run-oxlint: git ${args.join(' ')} failed:\n${result.stderr.trim()}`)
  }
  return result.stdout.split('\n').filter(line => line !== '')
}

function configuredBase(env: NodeJS.ProcessEnv): string | undefined {
  for (const name of [
    'DSH_OXLINT_BASE_REF',
    'DSH_ARCHIVE_BASE_REF',
    'CI_MERGE_REQUEST_DIFF_BASE_SHA',
    'CI_COMMIT_BEFORE_SHA',
  ]) {
    const value = env[name]
    if (value !== undefined && value !== '' && !/^0+$/.test(value)) return value
  }
  return undefined
}

/**
 * Resolve the repository files that the strict incremental lint gate owns.
 * @param cwd - Repository root containing the Git worktree.
 * @param env - Environment that may provide the trusted CI comparison base.
 * @returns Existing TypeScript files changed locally, against CI base, or by the current commit.
 */
export function resolveChangedFiles(cwd: string, env: NodeJS.ProcessEnv): string[] {
  const files = new Set<string>()
  const add = (paths: readonly string[]): void => {
    for (const path of paths) files.add(path)
  }

  add(gitLines(cwd, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']))
  add(gitLines(cwd, ['ls-files', '--others', '--exclude-standard']))

  const base = configuredBase(env)
  if (base !== undefined) {
    add(gitLines(cwd, ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]))
  } else if (files.size === 0) {
    add(gitLines(cwd, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--diff-filter=ACMR', 'HEAD']))
  }

  return [...files]
    .filter(path => LINTED_EXTENSIONS.has(extname(path)) && existsSync(resolvePath(cwd, path)))
    .sort()
}

function resolveChangedInvocationArgs(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): string[] {
  if (!args.includes(CHANGED_FLAG)) return [...args]
  const passthrough = args.filter(arg => arg !== CHANGED_FLAG)
  const files = resolveChangedFiles(cwd, env)
  if (files.length === 0) return []
  return [...passthrough, '--no-error-on-unmatched-pattern', ...files]
}

/** Complete Oxlint child-process arguments and environment. */
export interface OxlintInvocation {
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Apply the repository worker bound to both Oxlint backends.
 * @param args - Oxlint CLI arguments requested by the caller.
 * @param env - Environment inherited by the Oxlint process.
 * @returns the complete CLI arguments and child environment.
 */
export function resolveOxlintInvocation(args: readonly string[], env: NodeJS.ProcessEnv): OxlintInvocation {
  const raw = env.DSH_OXLINT_THREADS
  if (raw === undefined || raw === '') return { args: [...args], env: { ...env } }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    throw new Error(`run-oxlint: DSH_OXLINT_THREADS must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  if (args.some(arg => arg === '--threads' || arg.startsWith('--threads='))) {
    throw new Error('run-oxlint: use DSH_OXLINT_THREADS instead of passing --threads directly.')
  }
  return {
    args: [...args, `--threads=${raw}`],
    env: { ...env, GOMAXPROCS: raw },
  }
}

function completeFrom(result: { readonly signal: NodeJS.Signals | null; readonly status: number | null }): void {
  if (result.signal !== null) {
    process.kill(process.pid, result.signal)
    return
  }
  process.exitCode = result.status ?? 1
}

function main(): void {
  const args = resolveChangedInvocationArgs(process.argv.slice(2), process.cwd(), process.env)
  if (args.length === 0) return
  const invocation = resolveOxlintInvocation(args, process.env)
  if (!isFixInvocation(invocation.args)) {
    const result = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
      env: invocation.env,
      stdio: 'inherit',
    })
    if (result.error !== undefined) throw result.error
    completeFrom(result)
    return
  }

  const first = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    encoding: 'utf8',
    env: invocation.env,
    maxBuffer: MAX_CAPTURED_OUTPUT_BYTES,
  })
  if (first.error !== undefined) throw first.error
  if (first.signal !== null) {
    completeFrom(first)
    return
  }
  if (first.status === 0) {
    process.stdout.write(first.stdout)
    process.stderr.write(first.stderr)
    process.exitCode = 0
    return
  }

  // Overlapping JS-plugin fixes can expose one more fixable diagnostic after the first pass.
  const second = spawnSync(process.execPath, [oxlintCli, ...invocation.args], {
    env: invocation.env,
    stdio: 'inherit',
  })
  if (second.error !== undefined) throw second.error
  completeFrom(second)
}

const entrypoint = process.argv[1]
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main()
